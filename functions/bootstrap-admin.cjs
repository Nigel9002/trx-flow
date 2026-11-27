const { applicationDefault, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { createInterface } = require('node:readline/promises')
const { stdin, stdout } = require('node:process')

function getProjectId() {
  const projectIndex = process.argv.indexOf('--project')
  const projectArgument = projectIndex >= 0 ? process.argv[projectIndex + 1] : ''
  const inlineArgument = process.argv.find((argument) => argument.startsWith('--project='))
  const projectId = projectArgument || inlineArgument?.slice('--project='.length)
  if (!projectId || projectId.startsWith('--')) {
    throw new Error('Specify the Firebase project explicitly with --project <project-id>.')
  }
  return projectId
}

async function main() {
  const projectId = getProjectId()
  initializeApp({ credential: applicationDefault(), projectId })
  const auth = getAuth()
  const db = getFirestore()
  const prompt = createInterface({ input: stdin, output: stdout })
  let createdUid
  let reserved = false

  try {
    const name = (await prompt.question('Administrator name: ')).trim()
    const email = (await prompt.question('Administrator email: ')).trim().toLowerCase()
    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a name (up to 120 characters) and a valid email address.')
    }

    const lockRef = db.doc('systemHealth/initialAdminBootstrap')
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef)
      const admins = await transaction.get(db.collection('users').where('role', '==', 'admin').limit(1))
      if (lock.exists || !admins.empty) {
        throw new Error('Bootstrap is closed because an admin profile already exists or a bootstrap has already run.')
      }
      transaction.create(lockRef, {
        status: 'in-progress',
        email,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    reserved = true

    const user = await auth.createUser({ email, displayName: name, disabled: false })
    createdUid = user.uid
    await db.doc(`users/${user.uid}`).create({
      name,
      email,
      role: 'admin',
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      bootstrapSource: 'initial-admin-cli',
    })
    const resetLink = await auth.generatePasswordResetLink(email)
    await lockRef.update({
      status: 'complete',
      uid: user.uid,
      completedAt: FieldValue.serverTimestamp(),
    })

    console.log('\nInitial administrator created.')
    console.log('Set the account password using this one-time link:')
    console.log(resetLink)
    console.log('\nKeep the link private. It grants the ability to set the administrator password.')
  } catch (error) {
    const cleanupErrors = []
    if (createdUid) {
      try {
        await db.doc(`users/${createdUid}`).delete()
      } catch (cleanupError) {
        if (cleanupError.code !== 5) cleanupErrors.push(cleanupError)
      }
      try {
        await auth.deleteUser(createdUid)
      } catch (cleanupError) {
        if (cleanupError.code !== 'auth/user-not-found') cleanupErrors.push(cleanupError)
      }
    }
    if (reserved) {
      try {
        await db.doc('systemHealth/initialAdminBootstrap').delete()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length) {
      console.error(`Rollback was incomplete: ${cleanupErrors.map((cleanupError) => cleanupError.message).join('; ')}`)
    }
    throw error
  } finally {
    prompt.close()
  }
}

main().catch((error) => {
  console.error(`Admin bootstrap failed: ${error.message}`)
  process.exitCode = 1
})
