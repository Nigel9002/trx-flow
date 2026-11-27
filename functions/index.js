const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')

initializeApp()

const db = getFirestore()

function getDefaultStorageBucket() {
  const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}')
  return firebaseConfig.storageBucket
    ? getStorage().bucket(firebaseConfig.storageBucket)
    : getStorage().bucket()
}

async function requireActiveUser(uid) {
  const profile = await db.doc(`users/${uid}`).get()
  if (!profile.exists || profile.data().status !== 'active') {
    throw new HttpsError('permission-denied', 'An active account is required.')
  }
  return profile.data()
}

async function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in is required.')
  }

  const profile = await requireActiveUser(request.auth.uid)
  if (profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrator access is required.')
  }
}

async function writeAudit(event, action, targetId, actorUid, metadata = {}) {
  const profile = actorUid ? await db.doc(`users/${actorUid}`).get() : null
  await db.collection('auditLogs').doc(event.id).set({
    actorUid: actorUid || 'system',
    actorName: profile?.exists ? profile.data().name || '' : 'System',
    action,
    targetId,
    createdAt: FieldValue.serverTimestamp(),
    metadata,
  })
}

async function writeAccountHistory(event, action, accountId, actorUid, metadata = {}) {
  const profile = actorUid ? await db.doc(`users/${actorUid}`).get() : null
  await db.doc(`accounts/${accountId}/history/${event.id}`).set({
    actorUid: actorUid || 'system',
    actorName: profile?.exists ? profile.data().name || '' : 'System',
    action,
    metadata,
    createdAt: FieldValue.serverTimestamp(),
  })
}

exports.createEmployee = onCall(async (request) => {
  await requireAdmin(request)

  const email = String(request.data?.email || '').trim().toLowerCase()
  const name = String(request.data?.name || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 120) {
    throw new HttpsError('invalid-argument', 'Provide a valid employee name and email.')
  }

  let user
  try {
    user = await getAuth().createUser({ email, displayName: name, disabled: false })
    await db.doc(`users/${user.uid}`).create({
      name,
      email,
      role: 'employee',
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
    })
    const resetLink = await getAuth().generatePasswordResetLink(email)
    await db.collection('auditLogs').add({
      actorUid: request.auth.uid,
      action: 'employee.created',
      targetId: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      metadata: { email },
    })
    return { uid: user.uid, email, resetLink }
  } catch (error) {
    if (user) {
      await db.doc(`users/${user.uid}`).delete()
      await getAuth().deleteUser(user.uid)
    }
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account already uses this email.')
    }
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', 'Could not create the employee account.')
  }
})

exports.manageEmployee = onCall(async (request) => {
  await requireAdmin(request)

  const uid = String(request.data?.uid || '')
  const action = request.data?.action
  if (!uid || uid === request.auth.uid || !['disable', 'enable', 'sendResetLink'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Select a valid employee action.')
  }

  const profileRef = db.doc(`users/${uid}`)
  const profile = await profileRef.get()
  if (!profile.exists || profile.data().role !== 'employee') {
    throw new HttpsError('not-found', 'Employee profile was not found.')
  }

  let result = {}
  if (action === 'disable' || action === 'enable') {
    const disabled = action === 'disable'
    await getAuth().updateUser(uid, { disabled })
    await profileRef.update({
      status: disabled ? 'disabled' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
    })
  } else {
    const user = await getAuth().getUser(uid)
    if (!user.email) throw new HttpsError('failed-precondition', 'Employee does not have an email address.')
    result.resetLink = await getAuth().generatePasswordResetLink(user.email)
  }

  await db.collection('auditLogs').add({
    actorUid: request.auth.uid,
    action: `employee.${action}`,
    targetId: uid,
    createdAt: FieldValue.serverTimestamp(),
  })

  return result
})

exports.deleteBusinessDocument = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.')
  const profile = await requireActiveUser(request.auth.uid)
  const documentId = String(request.data?.documentId || '')
  if (!documentId) throw new HttpsError('invalid-argument', 'A document ID is required.')

  const documentRef = db.doc(`documents/${documentId}`)
  const document = await documentRef.get()
  if (!document.exists) throw new HttpsError('not-found', 'Document was not found.')
  const metadata = document.data()
  if (profile.role !== 'admin' && metadata.ownerId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You cannot delete this document.')
  }
  if (metadata.storagePath !== `documents/${metadata.ownerId}/${documentId}`) {
    throw new HttpsError('failed-precondition', 'Document storage path does not match its owner.')
  }

  await getDefaultStorageBucket().file(metadata.storagePath).delete()
  await documentRef.delete()
  await db.collection('auditLogs').add({
    actorUid: request.auth.uid,
    actorName: profile.name || '',
    action: 'document.deleted',
    targetId: documentId,
    createdAt: FieldValue.serverTimestamp(),
    metadata: { name: metadata.name },
  })
  return { deleted: true }
})

exports.deleteTaskAttachment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.')
  const profile = await requireActiveUser(request.auth.uid)
  const taskId = String(request.data?.taskId || '')
  const attachmentId = String(request.data?.attachmentId || '')
  if (!taskId || !attachmentId) throw new HttpsError('invalid-argument', 'A task and attachment are required.')

  const taskRef = db.doc(`tasks/${taskId}`)
  const attachmentRef = taskRef.collection('attachments').doc(attachmentId)
  const [task, attachment] = await Promise.all([taskRef.get(), attachmentRef.get()])
  if (!task.exists || !attachment.exists) throw new HttpsError('not-found', 'Task attachment was not found.')
  const metadata = attachment.data()
  const isAdmin = profile.role === 'admin'
  if (!isAdmin && (task.data().assignedTo !== request.auth.uid || metadata.ownerId !== request.auth.uid)) {
    throw new HttpsError('permission-denied', 'You cannot delete this task attachment.')
  }
  if (metadata.storagePath !== `task-attachments/${taskId}/${metadata.ownerId}/${attachmentId}`) {
    throw new HttpsError('failed-precondition', 'Task attachment storage path does not match its owner.')
  }

  await getDefaultStorageBucket().file(metadata.storagePath).delete()
  await attachmentRef.delete()
  await db.collection('auditLogs').add({
    actorUid: request.auth.uid,
    actorName: profile.name || '',
    action: 'task.attachment_deleted',
    targetId: attachmentId,
    createdAt: FieldValue.serverTimestamp(),
    metadata: { taskId, name: metadata.name },
  })
  return { deleted: true }
})

async function notifyUsers(userIds, title, message, metadata = {}) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  await Promise.all(uniqueIds.map((userId) => db.collection('notifications').add({
    userId,
    title,
    message,
    metadata,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  })))
}

exports.auditAccountCreated = onDocumentCreated('accounts/{accountId}', async (event) => {
  const account = event.data.data()
  await Promise.all([
    writeAudit(event, 'account.created', event.params.accountId, account.createdBy, { name: account.name }),
    writeAccountHistory(event, 'account.created', event.params.accountId, account.createdBy, { name: account.name }),
  ])
})

exports.auditAccountUpdated = onDocumentUpdated('accounts/{accountId}', async (event) => {
  const account = event.data.after.data()
  const metadata = {
    name: account.name,
    status: account.status,
    assignedEmployees: account.assignedEmployees || [],
  }
  await Promise.all([
    writeAudit(event, 'account.updated', event.params.accountId, account.updatedBy, metadata),
    writeAccountHistory(event, 'account.updated', event.params.accountId, account.updatedBy, metadata),
  ])
})

exports.auditPaymentCreated = onDocumentCreated('paymentRecords/{recordId}', async (event) => {
  const record = event.data.data()
  await writeAudit(event, 'payment.submitted', event.params.recordId, record.createdBy, { amount: record.amount })
})

exports.auditPaymentUpdated = onDocumentUpdated('paymentRecords/{recordId}', async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const action = before.status !== after.status
    ? `payment.${String(after.status).toLowerCase().replaceAll(' ', '_')}`
    : 'payment.correction_resubmitted'
  await writeAudit(event, action, event.params.recordId, after.reviewedBy || after.updatedBy, {
    status: after.status,
    note: after.reviewNote || '',
  })
})

exports.auditTaskCreated = onDocumentCreated('tasks/{taskId}', async (event) => {
  const task = event.data.data()
  await writeAudit(event, 'task.created', event.params.taskId, task.createdBy, { title: task.title, assignedTo: task.assignedTo })
})

exports.auditTaskUpdated = onDocumentUpdated('tasks/{taskId}', async (event) => {
  const task = event.data.after.data()
  await writeAudit(event, 'task.status_updated', event.params.taskId, task.updatedBy, { status: task.status })
})

exports.auditDocumentUploaded = onDocumentCreated('documents/{documentId}', async (event) => {
  const document = event.data.data()
  await writeAudit(event, 'document.uploaded', event.params.documentId, document.ownerId, { name: document.name, size: document.size })
})

exports.auditOrganizationSettings = onDocumentWritten('settings/{settingId}', async (event) => {
  const settings = event.data.after.data()
  if (!settings) return
  await writeAudit(event, 'settings.updated', event.params.settingId, settings.updatedBy, {
    name: settings.name,
    currency: settings.currency,
  })
})

exports.auditAmendmentCreated = onDocumentCreated('amendments/{amendmentId}', async (event) => {
  const amendment = event.data.data()
  await writeAudit(event, 'payment.amendment_requested', event.params.amendmentId, amendment.createdBy, {
    originalRecordId: amendment.originalRecordId,
  })
})

exports.auditAmendmentUpdated = onDocumentUpdated('amendments/{amendmentId}', async (event) => {
  const amendment = event.data.after.data()
  await writeAudit(event, `payment.amendment_${amendment.status.toLowerCase()}`, event.params.amendmentId, amendment.reviewedBy, {
    originalRecordId: amendment.originalRecordId,
    note: amendment.reviewNote || '',
  })
})

exports.auditReportExported = onDocumentCreated('exportHistory/{exportId}', async (event) => {
  const exportRecord = event.data.data()
  await writeAudit(event, 'report.exported', event.params.exportId, exportRecord.createdBy, {
    reportName: exportRecord.reportName,
    rowCount: exportRecord.rowCount,
  })
})

exports.auditMessageSent = onDocumentCreated('conversations/{conversationId}/messages/{messageId}', async (event) => {
  const message = event.data.data()
  await writeAudit(event, 'message.sent', event.params.messageId, message.senderId, {
    conversationId: event.params.conversationId,
  })
})

exports.notifyNewPayment = onDocumentCreated('paymentRecords/{recordId}', async (event) => {
  const payment = event.data.data()
  const admins = await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get()
  await notifyUsers(
    admins.docs.map((admin) => admin.id),
    'Payment record submitted',
    `${payment.createdByName || 'An employee'} submitted a payment record for review.`,
    { recordId: event.params.recordId },
  )
})

exports.notifyPaymentReview = onDocumentUpdated('paymentRecords/{recordId}', async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  if (before.status === after.status || !['Approved', 'Rejected', 'Correction Requested'].includes(after.status)) return
  await notifyUsers(
    [after.createdBy],
    `Payment record ${after.status.toLowerCase()}`,
    `Your payment record ${event.params.recordId} was ${after.status.toLowerCase()}.`,
    { recordId: event.params.recordId, status: after.status },
  )
})

exports.notifyTaskAssignment = onDocumentCreated('tasks/{taskId}', async (event) => {
  const task = event.data.data()
  await notifyUsers(
    [task.assignedTo],
    'New task assigned',
    task.title || 'A new task was assigned to you.',
    { taskId: event.params.taskId },
  )
})

exports.sendTaskDueReminders = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Etc/UTC', maxInstances: 1 },
  async () => {
    const today = new Date().toISOString().slice(0, 10)
    let cursor = null
    let page
    do {
      let taskQuery = db.collection('tasks').where('dueDate', '<=', today).orderBy('dueDate').limit(500)
      if (cursor) taskQuery = taskQuery.startAfter(cursor)
      page = await taskQuery.get()
      for (const taskDoc of page.docs) {
        const task = taskDoc.data()
        if (typeof task.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) continue
        if (task.status === 'Completed' || !task.assignedTo) continue
        const assignee = await db.doc(`users/${task.assignedTo}`).get()
        if (!assignee.exists || assignee.data().status !== 'active') continue

        const reminderRef = db.doc(`taskReminders/${taskDoc.id}_${today}`)
        const notificationRef = db.collection('notifications').doc()
        await db.runTransaction(async (transaction) => {
          const existing = await transaction.get(reminderRef)
          if (existing.exists) return
          transaction.create(reminderRef, {
            taskId: taskDoc.id,
            userId: task.assignedTo,
            dueDate: task.dueDate,
            createdAt: FieldValue.serverTimestamp(),
          })
          transaction.create(notificationRef, {
            userId: task.assignedTo,
            title: task.dueDate === today ? 'Task due today' : 'Task overdue',
            message: task.title || 'A task needs attention.',
            metadata: { taskId: taskDoc.id, dueDate: task.dueDate },
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          })
        })
      }
      cursor = page.docs.at(-1) || null
    } while (page.size === 500)
  },
)

exports.notifyAccountAssignment = onDocumentCreated('accounts/{accountId}', async (event) => {
  const account = event.data.data()
  await notifyUsers(
    account.assignedEmployees || [],
    'Account assigned',
    account.name || 'An account was assigned to you.',
    { accountId: event.params.accountId },
  )
})

exports.notifyAccountReassignment = onDocumentUpdated('accounts/{accountId}', async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const previous = before.assignedEmployees || []
  const current = after.assignedEmployees || []
  const added = current.filter((uid) => !previous.includes(uid))
  if (!added.length) return
  await notifyUsers(
    added,
    'Account assigned',
    after.name || 'An account was assigned to you.',
    { accountId: event.params.accountId },
  )
})

exports.notifyAmendmentRequest = onDocumentCreated('amendments/{amendmentId}', async (event) => {
  const amendment = event.data.data()
  const admins = await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get()
  await notifyUsers(
    admins.docs.map((admin) => admin.id),
    'Payment amendment requested',
    amendment.reason,
    { amendmentId: event.params.amendmentId },
  )
})

exports.notifyAmendmentReview = onDocumentUpdated('amendments/{amendmentId}', async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  if (before.status === after.status) return
  await notifyUsers(
    [after.createdBy],
    `Amendment ${after.status.toLowerCase()}`,
    after.reviewNote || `Your amendment request was ${after.status.toLowerCase()}.`,
    { amendmentId: event.params.amendmentId, status: after.status },
  )
})

exports.notifyNewMessage = onDocumentCreated('conversations/{conversationId}/messages/{messageId}', async (event) => {
  const message = event.data.data()
  const conversation = await db.doc(`conversations/${event.params.conversationId}`).get()
  if (!conversation.exists) return
  await notifyUsers(
    conversation.data().participants.filter((uid) => uid !== message.senderId),
    'New internal message',
    'A colleague sent you a message.',
    { conversationId: event.params.conversationId },
  )
})
