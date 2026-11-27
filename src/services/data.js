import {
  collection,
  doc,
  documentId,
  addDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'

export function subscribeToCollection(name, { role, uid }, onData, onError) {
  if (!db) {
    onError(new Error('Firebase is not configured.'))
    return () => {}
  }

  const collectionRef = collection(db, name)
  if (role !== 'admin') {
    let constraints
    if (name === 'accounts') constraints = [where('assignedEmployees', 'array-contains', uid)]
    else if (name === 'paymentRecords') constraints = [where('createdBy', '==', uid)]
    else if (name === 'tasks') constraints = [where('assignedTo', '==', uid)]
    else if (name === 'users') constraints = [where(documentId(), '==', uid)]
    else if (name === 'conversations') constraints = [where('participants', 'array-contains', uid)]
    else if (name === 'amendments') constraints = [where('createdBy', '==', uid)]
    else if (name === 'reports' || name === 'exportHistory' || name === 'settings') {
      onData([])
      return () => {}
    }
    else {
      onData([])
      return () => {}
    }

    return onSnapshot(query(collectionRef, ...constraints), (snapshot) => {
      onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })))
    }, onError)
  }

  const adminQuery = name === 'conversations'
    ? query(collectionRef, where('participants', 'array-contains', uid))
    : collectionRef

  return onSnapshot(adminQuery, (snapshot) => {
    onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })))
  }, onError)
}

export async function createAccount(data, actor) {
  const accountRef = doc(collection(db, 'accounts'))
  const batch = writeBatch(db)
  batch.set(accountRef, {
    ...data,
    assignedEmployees: data.assignedEmployees || [],
    status: data.status || 'Active',
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function updateAccount(account, data, actor) {
  const accountRef = doc(db, 'accounts', account.id)
  const batch = writeBatch(db)
  batch.update(accountRef, { ...data, updatedBy: actor.uid, updatedAt: serverTimestamp() })
  await batch.commit()
}

export async function createPaymentRecord(data, actor) {
  const paymentRef = doc(collection(db, 'paymentRecords'))
  const batch = writeBatch(db)
  batch.set(paymentRef, {
    ...data,
    amount: Number(data.amount),
    createdBy: actor.uid,
    updatedBy: actor.uid,
    status: 'Pending Review',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    history: [{ status: 'Pending Review', actorUid: actor.uid, at: new Date().toISOString() }],
  })
  await batch.commit()
}

export async function reviewPayment(record, decision, actor, note = '') {
  const batch = writeBatch(db)
  const paymentRef = doc(db, 'paymentRecords', record.id)
  const status = decision === 'approve' ? 'Approved' : decision === 'correction' ? 'Correction Requested' : 'Rejected'
  batch.update(paymentRef, {
    status,
    reviewNote: note,
    approvedBy: decision === 'approve' ? actor.uid : null,
    approvedByName: decision === 'approve' ? actor.name : null,
    reviewedBy: actor.uid,
    reviewedByName: actor.name,
    approvedAt: decision === 'approve' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
    history: [...(record.history || []), { status, actorUid: actor.uid, at: new Date().toISOString(), note }],
  })
  await batch.commit()
}

export async function resubmitPaymentCorrection(record, changes, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'paymentRecords', record.id), {
    ...changes,
    amount: Number(changes.amount),
    status: 'Pending Review',
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
    history: [...(record.history || []), {
      status: 'Pending Review',
      actorUid: actor.uid,
      at: new Date().toISOString(),
    }],
  })
  await batch.commit()
}

export async function createAmendment(record, changes, reason, actor) {
  const amendmentRef = doc(collection(db, 'amendments'))
  const batch = writeBatch(db)
  batch.set(amendmentRef, {
    originalRecordId: record.id,
    referenceNumber: record.referenceNumber || '',
    proposedChanges: changes,
    reason,
    status: 'Pending Review',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function reviewAmendment(amendment, status, actor, note = '') {
  const batch = writeBatch(db)
  batch.update(doc(db, 'amendments', amendment.id), {
    status,
    reviewNote: note,
    reviewedBy: actor.uid,
    reviewedByName: actor.name,
    reviewedAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function createTask(data, actor) {
  const taskRef = doc(collection(db, 'tasks'))
  const batch = writeBatch(db)
  batch.set(taskRef, {
    ...data,
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function updateTaskStatus(task, status, actor) {
  const taskRef = doc(db, 'tasks', task.id)
  const batch = writeBatch(db)
  batch.update(taskRef, { status, updatedBy: actor.uid, updatedAt: serverTimestamp() })
  await batch.commit()
}

export async function createConversation(recipient, initialMessage, actor) {
  const conversationRef = doc(collection(db, 'conversations'))
  await setDoc(conversationRef, {
    participants: [actor.uid, recipient.id],
    participantNames: { [actor.uid]: actor.name, [recipient.id]: recipient.name || recipient.email },
    lastMessage: initialMessage,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await sendConversationMessage(conversationRef.id, initialMessage, actor)
  return conversationRef.id
}

export async function sendConversationMessage(conversationId, text, actor) {
  const conversationRef = doc(db, 'conversations', conversationId)
  const messageRef = doc(collection(db, 'conversations', conversationId, 'messages'))
  const batch = writeBatch(db)
  batch.set(messageRef, {
    senderId: actor.uid,
    text,
    createdAt: serverTimestamp(),
  })
  batch.update(conversationRef, { lastMessage: text, updatedAt: serverTimestamp() })
  await batch.commit()
}

export function subscribeToMessages(conversationId, onData, onError) {
  return onSnapshot(
    query(collection(db, 'conversations', conversationId, 'messages')),
    (snapshot) => onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
    onError,
  )
}

export async function saveOrganizationSettings(settings, actor) {
  await setDoc(doc(db, 'settings', 'organization'), {
    ...settings,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function recordReportExport(reportName, rowCount, actor) {
  await addDoc(collection(db, 'exportHistory'), {
    reportName,
    rowCount,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  })
}

export function subscribeToOrganizationSettings(onData, onError) {
  return onSnapshot(doc(db, 'settings', 'organization'), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() : {})
  }, onError)
}

export async function listReportData(name, actor) {
  if (actor.role !== 'admin') throw new Error('Only administrators can export reports.')
  const snapshot = await getDocs(query(collection(db, name), limit(5000)))
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
}

export function downloadCsv(rows, fileName) {
  if (!rows.length) throw new Error('There is no data to export.')
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [columns.map(quote).join(','), ...rows.map((row) => columns.map((key) => quote(
    row[key]?.toDate ? row[key].toDate().toISOString() : row[key],
  )).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function dateLabel(value) {
  if (!value) return '—'
  const date = value.toDate ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}
