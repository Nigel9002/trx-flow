import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'

const projectId = 'trx-flow-rules-test'
let environment

before(async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  })
})

beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore()
    await setDoc(doc(database, 'users/admin-1'), {
      name: 'Admin User', email: 'admin@example.test', role: 'admin', status: 'active',
    })
    await setDoc(doc(database, 'users/employee-1'), {
      name: 'Employee User', email: 'employee@example.test', role: 'employee', status: 'active',
    })
    await setDoc(doc(database, 'users/employee-2'), {
      name: 'Other Employee', email: 'other@example.test', role: 'employee', status: 'active',
    })
    await setDoc(doc(database, 'accounts/assigned'), {
      name: 'Assigned account', assignedEmployees: ['employee-1'], status: 'Active',
    })
    await setDoc(doc(database, 'accounts/private'), {
      name: 'Private account', assignedEmployees: ['employee-2'], status: 'Active',
    })
    await setDoc(doc(database, 'paymentRecords/pending'), {
      createdBy: 'employee-1', amount: 25, currency: 'USD', accountId: 'assigned', status: 'Pending Review',
    })
    await setDoc(doc(database, 'paymentRecords/admin-own'), {
      createdBy: 'admin-1', amount: 25, currency: 'USD', accountId: 'assigned', status: 'Pending Review',
    })
    await setDoc(doc(database, 'paymentRecords/approved'), {
      createdBy: 'employee-1', amount: 25, currency: 'USD', accountId: 'assigned', status: 'Approved',
    })
    await setDoc(doc(database, 'paymentRecords/correction'), {
      createdBy: 'employee-1', amount: 25, currency: 'USD', accountId: 'assigned', status: 'Correction Requested',
    })
    await setDoc(doc(database, 'tasks/employee-task'), {
      title: 'Assigned task', assignedTo: 'employee-1', status: 'To Do',
    })
  })
})

after(async () => {
  await environment?.cleanup()
})

test('employees can read their own profile and assigned accounts only', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  await assertSucceeds(getDoc(doc(database, 'users/employee-1')))
  await assertFails(getDoc(doc(database, 'users/employee-2')))
  await assertSucceeds(getDoc(doc(database, 'accounts/assigned')))
  await assertFails(getDoc(doc(database, 'accounts/private')))
})

test('employees cannot create users or approve payment records', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  await assertFails(setDoc(doc(database, 'users/new-user'), {
    role: 'admin', status: 'active',
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/pending'), { status: 'Approved' }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/approved'), { amount: 900 }))
  await assertFails(setDoc(doc(database, 'auditLogs/fake'), {
    actorUid: 'employee-1', action: 'payment.approved', targetId: 'approved',
  }))
})

test('employees can submit a valid payment record but invalid amounts are rejected', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  await assertSucceeds(setDoc(doc(database, 'paymentRecords/valid'), {
    createdBy: 'employee-1', amount: 12.5, currency: 'USD', accountId: 'assigned', status: 'Pending Review',
  }))
  await assertFails(setDoc(doc(database, 'paymentRecords/invalid'), {
    createdBy: 'employee-1', amount: -1, currency: 'USD', accountId: 'assigned', status: 'Pending Review',
  }))
})

test('employees can resubmit a requested correction but cannot alter protected fields', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  await assertSucceeds(updateDoc(doc(database, 'paymentRecords/correction'), {
    amount: 30,
    status: 'Pending Review',
    updatedBy: 'employee-1',
    history: [{ status: 'Pending Review', actorUid: 'employee-1' }],
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/correction'), {
    status: 'Approved',
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/correction'), {
    createdBy: 'employee-2',
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/correction'), {
    amount: -1,
    status: 'Pending Review',
    updatedBy: 'employee-1',
    history: [{ status: 'Pending Review', actorUid: 'employee-1' }],
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/correction'), {
    currency: 'FAKE',
    status: 'Pending Review',
    updatedBy: 'employee-1',
    history: [{ status: 'Pending Review', actorUid: 'employee-1' }],
  }))
})

test('employees can update their assigned task status but cannot reassign it', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  await assertSucceeds(updateDoc(doc(database, 'tasks/employee-task'), { status: 'In Progress', updatedBy: 'employee-1' }))
  await assertFails(updateDoc(doc(database, 'tasks/employee-task'), { assignedTo: 'employee-2' }))
})

test('admin can review pending payments, but approved payment data is immutable', async () => {
  const database = environment.authenticatedContext('admin-1').firestore()
  await assertSucceeds(updateDoc(doc(database, 'paymentRecords/pending'), {
    status: 'Approved',
    reviewedBy: 'admin-1',
    history: [{ status: 'Approved', actorUid: 'admin-1' }],
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/admin-own'), {
    status: 'Approved',
    reviewedBy: 'admin-1',
    history: [{ status: 'Approved', actorUid: 'admin-1' }],
  }))
  await assertFails(updateDoc(doc(database, 'paymentRecords/approved'), { amount: 99 }))
})

test('employees can request amendments only for their own approved records', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  await assertSucceeds(setDoc(doc(database, 'amendments/own-request'), {
    originalRecordId: 'approved',
    createdBy: 'employee-1',
    status: 'Pending Review',
    reason: 'Correct the reference number',
    proposedChanges: { referenceNumber: 'NEW-REF' },
  }))
  await assertFails(setDoc(doc(database, 'amendments/other-record'), {
    originalRecordId: 'pending',
    createdBy: 'employee-1',
    status: 'Pending Review',
    reason: 'Try to amend an unapproved record',
    proposedChanges: { amount: 900 },
  }))
})

test('admin can decide amendment requests but cannot change the proposed values', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'amendments/request-1'), {
      originalRecordId: 'approved',
      createdBy: 'employee-1',
      status: 'Pending Review',
      reason: 'Correct reference',
      proposedChanges: { referenceNumber: 'NEW-REF' },
    })
  })
  const database = environment.authenticatedContext('admin-1').firestore()
  await assertSucceeds(updateDoc(doc(database, 'amendments/request-1'), {
    status: 'Approved',
    reviewedBy: 'admin-1',
  }))
  await assertFails(updateDoc(doc(database, 'amendments/request-1'), { 'proposedChanges.amount': 100 }))
})

test('employee collection queries are constrained to their own records', async () => {
  const database = environment.authenticatedContext('employee-1').firestore()
  const assignedAccounts = query(collection(database, 'accounts'), where('assignedEmployees', 'array-contains', 'employee-1'))
  const allAccounts = collection(database, 'accounts')
  await assertSucceeds(getDocs(assignedAccounts))
  await assertFails(getDocs(allAccounts))
})

test('conversation queries return only conversations the user participates in', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore()
    await setDoc(doc(database, 'conversations/employee-conversation'), {
      participants: ['admin-1', 'employee-1'],
      lastMessage: 'Hello',
    })
    await setDoc(doc(database, 'conversations/private-conversation'), {
      participants: ['employee-1', 'employee-2'],
      lastMessage: 'Private',
    })
  })

  const adminDatabase = environment.authenticatedContext('admin-1').firestore()
  await assertSucceeds(getDoc(doc(adminDatabase, 'conversations/employee-conversation')))
  const adminConversations = query(
    collection(adminDatabase, 'conversations'),
    where('participants', 'array-contains', 'admin-1'),
  )
  const conversations = await assertSucceeds(getDocs(adminConversations))
  assert.equal(conversations.size, 1)
  assert.equal(conversations.docs[0].id, 'employee-conversation')
})
