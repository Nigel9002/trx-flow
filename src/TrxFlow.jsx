import { useEffect, useState } from 'react'
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, firebaseEnabled } from './firebase'
import './TrxFlowEnhancements.css'
import {
  createAccount, createAmendment, createConversation, createPaymentRecord, createTask, dateLabel,
  downloadCsv, listReportData, recordReportExport,
  resubmitPaymentCorrection, reviewAmendment, reviewPayment, saveOrganizationSettings, sendConversationMessage,
  subscribeToCollection, subscribeToMessages, subscribeToOrganizationSettings, updateAccount, updateTaskStatus,
} from './services/data'
import {
  LayoutDashboard, Users, Building2, ReceiptText, ClipboardCheck,
  MessageSquare, FileText, Settings, Activity, Search, Sun, Moon,
  Plus, ArrowUpRight, MoreHorizontal, CheckCircle2, Clock3,
  X, Menu, ChevronDown, ShieldCheck, Send
} from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function Login({ onLogin, onResetPassword, startupError }) {
  const [role, setRole] = useState('admin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onLogin({ email, password, selectedRole: role })
    } catch (caught) {
      setPassword('')
      const code = caught?.code || ''
      const message = code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'Email or password is incorrect.'
          : code === 'auth/user-disabled'
            ? 'This account is disabled. Contact an administrator.'
          : code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed'
            ? 'Email and password sign-in is not enabled for this Firebase project. Enable the Email/Password provider in Firebase Authentication.'
            : code === 'auth/unauthorized-domain'
              ? 'This website domain is not authorized for Firebase Authentication. Add it under Authentication settings in Firebase Console.'
              : code === 'auth/invalid-api-key'
                ? 'The Firebase API key is invalid. Check the VITE_FIREBASE_API_KEY setting.'
                : code === 'auth/network-request-failed'
                  ? 'Could not reach Firebase Authentication. Check your internet connection and try again.'
            : caught?.message || String(caught)
      setError(message)
    } finally {
      setLoading(false)
    }
  }
  const displayError = error || startupError
  return <main className="login-page">
    <section className="login-brand"><div className="brand-mark">T</div><div><strong>TRX FLOW</strong><span>Operations Platform</span></div></section>
    <section className="login-card">
      <div className="login-heading"><p>Welcome back</p><h1>Sign in to TRX FLOW</h1></div>
      <form onSubmit={submit}>
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<div className="password-wrap"><input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required /><button type="button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div></label>
        <div className="login-options"><span className="login-hint">Authorized staff only</span><button type="button" className="link-button" onClick={() => onResetPassword(email)}>Forgot password?</button></div>
        <div className="role-choice"><button type="button" className={role === 'admin' ? 'active' : ''} onClick={() => setRole('admin')}>Admin access</button><button type="button" className={role === 'employee' ? 'active' : ''} onClick={() => setRole('employee')}>Employee access</button></div>
        {displayError && <div className="login-error" role="alert">{displayError}</div>}
        <button className="primary login-submit" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'} <ArrowUpRight size={17}/></button>
      </form>
      <div className="login-security"><ShieldCheck size={15}/> Protected by enterprise authentication</div>
    </section>
  </main>
}

function Status({ value }) {
  const type = value.toLowerCase().replace(/\s+/g, '-')
  return <span className={`status ${type}`}><i />{value}</span>
}

export default function TrxFlow() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(firebaseEnabled)
  const [page, setPage] = useState('Dashboard')
  const [theme, setTheme] = useState(() => localStorage.getItem('trxflow-theme') || 'dark')
  const [sidebar, setSidebar] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [accountToEdit, setAccountToEdit] = useState(null)
  const [amendmentRecord, setAmendmentRecord] = useState(null)
  const [correctionRecord, setCorrectionRecord] = useState(null)
  const [data, setData] = useState({ accounts: [], paymentRecords: [], tasks: [], users: [], conversations: [], amendments: [] })
  const [organizationSettings, setOrganizationSettings] = useState({})
  const [reportPreview, setReportPreview] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [dataErrors, setDataErrors] = useState({})
  const [authStartupError, setAuthStartupError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('trxflow-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setSession(null)
        setAuthLoading(false)
        return
      }

      try {
        const profileSnap = await getDoc(doc(db, 'users', user.uid))
        if (!profileSnap.exists()) {
          setAuthStartupError('No authorized profile is linked to this Firebase account. Ask an administrator to finish account setup.')
          await signOut(auth)
          setSession(null)
          setAuthLoading(false)
          return
        }
        const profile = profileSnap.data()
        if (profile.status !== 'active') {
          setAuthStartupError('This account is disabled. Contact an administrator.')
          await signOut(auth)
          setSession(null)
          setAuthLoading(false)
          return
        }
        if (!['admin', 'employee'].includes(profile.role)) {
          setAuthStartupError('This account profile has an invalid role. Contact an administrator.')
          await signOut(auth)
          setSession(null)
          setAuthLoading(false)
          return
        }
        setAuthStartupError('')
        setSession({
          role: profile.role,
          name: profile.name || user.email || 'User',
          uid: user.uid,
          email: user.email,
        })
      } catch (error) {
        setAuthStartupError(error.message || 'Could not load your account profile. Check Firestore access and try again.')
        setSession(null)
      } finally {
        setAuthLoading(false)
      }
    })
  }, [])

  useEffect(() => {
    if (!session?.uid || !firebaseEnabled) return undefined
    const sources = ['accounts', 'paymentRecords', 'tasks', 'users', 'conversations', 'amendments']
    const unsubscribers = sources.map((name) => subscribeToCollection(
      name,
      session,
      (items) => {
        setData((current) => ({ ...current, [name]: items }))
        setDataErrors((current) => {
          const next = { ...current }
          delete next[name]
          return next
        })
        setLastSync(new Date())
      },
      (error) => setDataErrors((current) => ({ ...current, [name]: error.message })),
    ))
    const unsubscribeSettings = subscribeToOrganizationSettings(
      setOrganizationSettings,
      (error) => setDataErrors((current) => ({ ...current, settings: error.message })),
    )
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      unsubscribeSettings()
    }
  }, [session])
  const dataError = Object.entries(dataErrors).map(([source, message]) => `${source}: ${message}`).join(' · ')

  const handleLogin = async ({ email, password, selectedRole }) => {
    setAuthStartupError('')
    if (!firebaseEnabled) {
      throw new Error('Firebase is not configured. Add the project settings to .env and restart the app.')
    }

    const credential = await signInWithEmailAndPassword(auth, email, password)
    let profileSnap
    try {
      profileSnap = await getDoc(doc(db, 'users', credential.user.uid))
    } catch (error) {
      await signOut(auth)
      throw error
    }

    if (!profileSnap.exists()) {
      await signOut(auth)
      throw new Error('No authorized employee profile was found.')
    }

    const profile = profileSnap.data()
    if (profile.status !== 'active') {
      await signOut(auth)
      throw new Error('This account is disabled. Contact an administrator.')
    }

    if (!['admin', 'employee'].includes(profile.role)) {
      await signOut(auth)
      throw new Error('This user profile has an invalid role. Contact an administrator.')
    }

    const role = profile.role
    if (role !== selectedRole) {
      await signOut(auth)
      throw new Error('Your account does not have access for the selected role.')
    }

    setAuthStartupError('')
    setSession({ role, name: profile.name || credential.user.email || 'User', uid: credential.user.uid })
  }

  const handleLogout = async () => {
    if (firebaseEnabled) await signOut(auth)
    setSession(null)
    setAuthStartupError('')
  }

  const handleResetPassword = async (email) => {
    if (!email) throw new Error('Enter your email address first.')
    if (!auth) throw new Error('Firebase is not configured.')
    await sendPasswordResetEmail(auth, email)
    window.alert('If an account exists for this address, a password reset email has been sent.')
  }

  if (authLoading) return <main className="login-page"><p>Checking your session…</p></main>
  if (!session) return <Login onLogin={handleLogin} onResetPassword={(email) => handleResetPassword(email).catch((error) => window.alert(error.message))} startupError={authStartupError} />

  const allNav = [
    ['Dashboard', LayoutDashboard], ['Accounts', Building2], ['Payment Records', ReceiptText], ['Amendments', ClipboardCheck],
    ['Employees', Users], ['Tasks', ClipboardCheck], ['Messages', MessageSquare],
    ['Reports', FileText], ['Settings', Settings], ['System Health', Activity]
  ]
  const adminOnly = new Set(['Employees', 'Reports', 'Settings', 'System Health'])
  const nav = allNav.filter(([label]) => session.role === 'admin' || !adminOnly.has(label))

  const filteredAccounts = data.accounts.filter(a =>
    (session.role === 'admin' || a.status !== 'Archived')
    && `${a.id} ${a.name} ${a.assignedToName || ''}`.toLowerCase().includes(search.toLowerCase()),
  )
  const filteredPayments = data.paymentRecords.filter((record) => `${record.id} ${record.accountName} ${record.referenceNumber} ${record.createdByName} ${record.status}`.toLowerCase().includes(search.toLowerCase()))
  const searchResults = search.trim() ? [
    ...data.accounts.map((item) => ({ type: 'Account', title: item.name, target: 'Accounts', text: `${item.id} ${item.name}` })),
    ...data.paymentRecords.map((item) => ({ type: 'Payment', title: item.referenceNumber || item.id.slice(0, 8), target: 'Payment Records', text: `${item.referenceNumber} ${item.accountName} ${item.status}` })),
    ...data.amendments.map((item) => ({ type: 'Amendment', title: item.referenceNumber || item.originalRecordId, target: 'Amendments', text: `${item.referenceNumber} ${item.originalRecordId} ${item.reason} ${item.status}` })),
    ...data.users.map((item) => ({ type: 'Employee', title: item.name || item.email, target: 'Employees', text: `${item.name} ${item.email}` })),
    ...data.tasks.map((item) => ({ type: 'Task', title: item.title, target: 'Tasks', text: `${item.title} ${item.description}` })),
    ...data.conversations.map((item) => ({ type: 'Message', title: item.lastMessage, target: 'Messages', text: item.lastMessage })),
  ].filter((item) => item.text?.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 6) : []

  const openCreate = () => setModal(true)

  const runAction = async (action) => {
    setActionLoading(true)
    setActionError('')
    try {
      await action()
      return true
    } catch (error) {
      setActionError(error.message || 'The action failed. Check your connection and permissions.')
      return false
    } finally {
      setActionLoading(false)
    }
  }

  const handleResubmitCorrection = async (form) => {
    if (!correctionRecord) return
    const saved = await runAction(() => resubmitPaymentCorrection(correctionRecord, {
      accountId: form.accountId,
      accountName: data.accounts.find((account) => account.id === form.accountId)?.name || '',
      amount: form.amount,
      currency: form.currency,
      category: form.category,
      referenceNumber: form.referenceNumber,
      notes: form.notes,
    }, session))
    if (saved) setCorrectionRecord(null)
  }

  const handleCreateAmendment = async (form) => {
    if (!amendmentRecord) return
    const saved = await runAction(() => createAmendment(amendmentRecord, {
      amount: Number(form.amount),
      currency: form.currency,
      category: form.category,
      referenceNumber: form.referenceNumber,
      notes: form.notes,
    }, form.reason, session))
    if (saved) setAmendmentRecord(null)
  }

  const handleReviewAmendment = async (amendment, status) => {
    const note = status === 'Rejected' ? window.prompt('Reason for rejecting this amendment:') || '' : ''
    if (status === 'Rejected' && !note.trim()) return
    await runAction(() => reviewAmendment(amendment, status, session, note.trim()))
  }

  const handleCreate = async (form) => {
    if (page === 'Accounts') {
      await createAccount({
        name: form.name,
        type: form.type,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        notes: form.notes,
        assignedEmployees: form.assignedTo ? [form.assignedTo] : [],
        assignedToName: data.users.find((user) => user.id === form.assignedTo)?.name || '',
      }, session)
    } else if (page === 'Payment Records') {
      await createPaymentRecord({
        accountId: form.accountId,
        accountName: data.accounts.find((account) => account.id === form.accountId)?.name || '',
        amount: form.amount,
        currency: form.currency,
        category: form.category,
        referenceNumber: form.referenceNumber,
        notes: form.notes,
        date: form.date,
      }, session)
    } else if (page === 'Tasks') {
      await createTask({
        title: form.name,
        description: form.notes,
        assignedTo: form.assignedTo,
        priority: form.priority,
        dueDate: form.dueDate,
        status: 'To Do',
      }, session)
    } else if (page === 'Messages') {
      const recipient = data.users.find((user) => user.id === form.recipientId)
      if (!recipient) throw new Error('Choose a valid recipient.')
      await createConversation(recipient, form.message.trim(), session)
    } else {
      throw new Error('This action is not available yet.')
    }
    setModal(false)
  }

  const handleReportExport = async (name) => {
    const records = await listReportData(name, session)
    downloadCsv(records, `${name}-${new Date().toISOString().slice(0, 10)}.csv`)
    await recordReportExport(name, records.length, session)
  }

  const handleReportPreview = async (name) => {
    const records = await listReportData(name, session)
    if (!records.length) throw new Error('There is no data to include in this report.')
    await recordReportExport(name, records.length, session)
    setReportPreview({ name, records, generatedAt: new Date() })
  }

  const handleReviewPayment = async (record, decision) => {
    let note = ''
    if (decision !== 'approve') {
      note = window.prompt(decision === 'correction' ? 'Reason for requesting a correction:' : 'Reason for rejecting this record:') || ''
      if (!note.trim()) return
    }
    await runAction(() => reviewPayment(record, decision, session, note.trim()))
  }

  const resetEmployeePassword = async (email) => {
    await sendPasswordResetEmail(auth, email)
    window.alert(`A password reset email has been sent to ${email}.`)
  }

  const handleUpdateAccount = async (form) => {
    if (!accountToEdit) return
    const saved = await runAction(() => updateAccount(accountToEdit, {
      name: form.name,
      type: form.type,
      status: form.status,
      notes: form.notes,
      assignedEmployees: form.assignedTo ? [form.assignedTo] : [],
      assignedToName: data.users.find((user) => user.id === form.assignedTo)?.name || '',
    }, session))
    if (saved) setAccountToEdit(null)
  }

  const archiveAccount = async (account) => {
    if (!window.confirm(`Archive ${account.name}? Employees will no longer see this account.`)) return
    await runAction(() => updateAccount(account, { status: 'Archived' }, session))
  }

  return <div className="app-shell">
    {sidebar && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">T</div><div><strong>{organizationSettings.name || 'TRX FLOW'}</strong><span>Operations</span></div></div>
      <nav>{nav.map(([label, Icon]) => <button key={label} className={page === label ? 'active' : ''} onClick={() => { setPage(label); setSidebar(false) }}><Icon size={18}/><span>{label}</span>{label === 'Messages' && <b>3</b>}</button>)}</nav>
      <div className="sidebar-user"><div className="avatar">OM</div><div><strong>{session.name}</strong><span>{session.role === 'admin' ? 'Administrator' : 'Employee'}</span></div><ChevronDown size={15}/></div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setSidebar(true)}><Menu size={20}/></button>
        <div className="global-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts, records, employees..." aria-label="Search authorized records"/><kbd>⌘ K</kbd>{searchResults.length > 0 && <div className="global-search-results">{searchResults.map((item, index) => <button key={`${item.type}-${index}`} onClick={() => { setPage(item.target); setSearch('') }}><span>{item.type}</span><strong>{item.title || 'Untitled'}</strong></button>)}</div>}</div>
        <div className="top-actions"><button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="top-avatar" aria-label="Sign out" onClick={handleLogout}>{session.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</button></div>
      </header>

      <main className="content">
        {dataError && <div className="app-error" role="alert">{dataError}</div>}
        {actionError && <div className="app-error" role="alert">{actionError}<button onClick={() => setActionError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
        <div className="page-heading"><div><div className="breadcrumbs">Workspace <span>/</span> {page}</div><h1>{page}</h1></div>{(page === 'Payment Records' || (session.role === 'admin' && ['Accounts','Tasks'].includes(page))) && <button className="primary" onClick={openCreate}><Plus size={17}/>{page === 'Payment Records' ? 'Add record' : page === 'Accounts' ? 'Create account' : 'Create task'}</button>}</div>

        {page === 'Dashboard' && <Dashboard setPage={setPage} data={data} />}
        {page === 'Accounts' && <Accounts data={filteredAccounts} role={session.role} onEdit={setAccountToEdit} onArchive={archiveAccount} />}
        {page === 'Payment Records' && <Payments data={filteredPayments} users={data.users} role={session.role} currentUid={session.uid} onReview={handleReviewPayment} onAmend={setAmendmentRecord} onCorrect={setCorrectionRecord} />}
        {page === 'Amendments' && <Amendments data={data.amendments} users={data.users} role={session.role} onReview={handleReviewAmendment} />}
        {page === 'Employees' && <Employees data={data.users.filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(search.toLowerCase()))} onReset={(email) => runAction(() => resetEmployeePassword(email))} loading={actionLoading} />}
        {page === 'Tasks' && <Tasks data={data.tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase()))} employees={data.users} role={session.role} onStatus={(task, status) => runAction(() => updateTaskStatus(task, status, session))} />}
        {page === 'Messages' && <Messages conversations={data.conversations} users={data.users} session={session} onStart={(form) => runAction(() => handleCreate(form))} />}
        {page === 'Reports' && <Reports preview={reportPreview} onClosePreview={() => setReportPreview(null)} onPrint={(name) => runAction(() => handleReportPreview(name))} onExport={(name) => runAction(() => handleReportExport(name))} />}
        {page === 'Settings' && <SettingsPage key={`${organizationSettings.name || ''}-${organizationSettings.currency || ''}`} settings={organizationSettings} onSave={(settings) => runAction(() => saveOrganizationSettings(settings, session))} />}
        {page === 'System Health' && <Health firebaseEnabled={firebaseEnabled} dataError={dataError} lastSync={lastSync} />}
      </main>
    </div>

    {modal && <CreateModal page={page} accounts={data.accounts} employees={data.users} defaultCurrency={organizationSettings.currency || 'USD'} onClose={() => setModal(false)} onSubmit={(form) => runAction(() => handleCreate(form))} loading={actionLoading} />}
    {amendmentRecord && <AmendmentModal record={amendmentRecord} onClose={() => setAmendmentRecord(null)} onSubmit={handleCreateAmendment} loading={actionLoading} />}
    {correctionRecord && <CorrectionModal record={correctionRecord} accounts={data.accounts} onClose={() => setCorrectionRecord(null)} onSubmit={handleResubmitCorrection} loading={actionLoading} />}
    {accountToEdit && <EditAccountModal account={accountToEdit} employees={data.users} onClose={() => setAccountToEdit(null)} onSubmit={handleUpdateAccount} loading={actionLoading} />}
  </div>
}

function Dashboard({ setPage, data }) {
  const pending = data.paymentRecords.filter((record) => record.status === 'Pending Review').length
  const approved = data.paymentRecords.filter((record) => record.status === 'Approved')
  const approvedTotal = approved.reduce((sum, record) => sum + Number(record.amount || 0), 0)
  const stats = [
    ['Accounts', data.accounts.length], ['Employees', data.users.filter((user) => user.role === 'employee').length],
    ['Pending records', pending], ['Approved value', new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(approvedTotal)],
  ]
  const records = data.paymentRecords.slice(0, 3)
  const statuses = ['Approved', 'Pending Review', 'Rejected'].map((status) => ({
    status,
    count: data.paymentRecords.filter((record) => record.status === status).length,
  }))
  const total = data.paymentRecords.length || 1
  return <><div className="stats-grid">{stats.map(([title, value]) => <article className="stat-card" key={title}><div className="stat-top"><span>{title}</span><MoreHorizontal size={17}/></div><strong>{value}</strong><div className="change"><span>Live Firestore data</span></div></article>)}</div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h3>Payment activity</h3><p>Latest recorded payment amounts</p></div></div><div className="chart-summary"><strong>{records.length} recent records</strong></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.paymentRecords.slice(0, 8).map((record, index) => ({ name: record.referenceNumber || `Record ${index + 1}`, amount: Number(record.amount || 0) }))}><defs><linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f7cff" stopOpacity={0.28}/><stop offset="95%" stopColor="#4f7cff" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey="amount" stroke="#4f7cff" strokeWidth={2.5} fill="url(#blue)"/></AreaChart></ResponsiveContainer></div></section>
    <section className="panel"><div className="panel-heading"><div><h3>Record status</h3><p>Current approval pipeline</p></div></div><div className="status-chart"><div className="donut"><div><strong>{pending}</strong><span>Pending</span></div></div><div className="legend">{statuses.map(({ status, count }) => <p key={status}><i className={status === 'Approved' ? 'approved' : status === 'Rejected' ? 'rejected' : 'pending'}/><span>{status}</span><strong>{Math.round(count / total * 100)}%</strong></p>)}</div></div></section></div>
    <section className="panel table-panel"><div className="panel-heading"><div><h3>Recent payment records</h3><p>Latest submissions</p></div><button className="link-button" onClick={() => setPage('Payment Records')}>View all <ArrowUpRight size={14}/></button></div><PaymentTable rows={records} users={data.users} /></section>
  </>
}

function Pagination({ page, pageSize, total, onChange }) {
  const pageCount = Math.ceil(total / pageSize)
  useEffect(() => {
    if (pageCount > 0 && page > pageCount) onChange(pageCount)
  }, [page, pageCount, onChange])
  if (pageCount <= 1) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return <div className="pagination"><span>Showing {first}–{last} of {total}</span><div><button disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page === pageCount} onClick={() => onChange(page + 1)}>Next</button></div></div>
}

function Accounts({ data, role, onEdit, onArchive }) {
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const filtered = data.filter((account) => (status === 'all' || (account.status || 'Active') === status) && (type === 'all' || account.type === type))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  return <section className="panel table-panel"><div className="table-toolbar"><div><h3>All accounts</h3><p>{filtered.length} accounts found</p></div><div className="toolbar-actions"><select aria-label="Filter accounts by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="all">All statuses</option>{['Active', 'Inactive', 'Review', 'Archived'].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Filter accounts by type" value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}><option value="all">All types</option>{['Business', 'Enterprise', 'Individual'].map((value) => <option key={value}>{value}</option>)}</select></div></div><div className="table-wrap"><table><thead><tr><th>Account</th><th>Assigned to</th><th>Type</th><th>Status</th><th>Created</th>{role === 'admin' && <th>Actions</th>}</tr></thead><tbody>{visible.map((a) => <tr key={a.id}><td><div className="account-name"><div className="account-icon"><Building2 size={16}/></div><div><strong>{a.name}</strong><span>{a.id}</span></div></div></td><td>{a.assignedToName || (a.assignedEmployees || []).join(', ') || 'Unassigned'}</td><td>{a.type || '—'}</td><td><Status value={a.status || 'Active'}/></td><td>{dateLabel(a.createdAt)}</td>{role === 'admin' && <td><div className="inline-actions"><button onClick={() => onEdit(a)}>Edit</button>{a.status !== 'Archived' && <button className="reject-button" onClick={() => onArchive(a)}>Archive</button>}</div></td>}</tr>)}</tbody></table>{filtered.length === 0 && <p className="empty-state">No accounts available for this account.</p>}</div><Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage}/></section>
}

function PaymentTable({ rows, users = [], role, currentUid, onReview, onAmend, onCorrect }) { return <div className="table-wrap"><table><thead><tr><th>Record</th><th>Account</th><th>Employee</th><th>Amount</th><th>Date</th><th>Status</th>{(role === 'admin' || role === 'employee') && <th>Action</th>}</tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.referenceNumber || r.id.slice(0, 8)}</strong></td><td>{r.accountName || r.accountId || '—'}</td><td>{users.find((user) => user.id === r.createdBy)?.name || r.createdBy}</td><td className="amount">{new Intl.NumberFormat(undefined, { style: 'currency', currency: r.currency || 'USD' }).format(Number(r.amount || 0))}</td><td>{dateLabel(r.date || r.createdAt)}</td><td><Status value={r.status || 'Draft'}/>{r.reviewNote && <small className="review-note">{r.reviewNote}</small>}</td>{role === 'admin' && <td>{r.status === 'Pending Review' ? <div className="inline-actions">{r.createdBy !== currentUid && <button className="approve-button" onClick={() => onReview(r, 'approve')}>Approve</button>}<button className="reject-button" onClick={() => onReview(r, 'reject')}>Reject</button><button onClick={() => onReview(r, 'correction')}>Request correction</button></div> : '—'}</td>}{role === 'employee' && <td>{r.status === 'Approved' ? <button className="filter-button" onClick={() => onAmend(r)}>Request amendment</button> : r.status === 'Correction Requested' ? <button className="filter-button" onClick={() => onCorrect(r)}>Submit correction</button> : '—'}</td>}</tr>)}</tbody></table>{rows.length === 0 && <p className="empty-state">No payment records yet.</p>}</div> }
function Payments({ data, users, role, currentUid, onReview, onAmend, onCorrect }) {
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const filtered = data.filter((record) => status === 'all' || record.status === status)
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  return <section className="panel table-panel"><div className="table-toolbar"><div><h3>Payment records</h3><p>{filtered.length} records · filter and review submissions</p></div><div className="toolbar-actions"><select aria-label="Filter payments by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="all">All statuses</option>{['Draft', 'Pending Review', 'Approved', 'Correction Requested', 'Rejected', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}</select></div></div><PaymentTable rows={visible} users={users} role={role} currentUid={currentUid} onReview={onReview} onAmend={onAmend} onCorrect={onCorrect}/><Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage}/></section>
}
function Amendments({ data, users, role, onReview }) { return <section className="panel table-panel"><div className="table-toolbar"><div><h3>Payment amendments</h3><p>Approved original records remain unchanged; amendment decisions are stored separately.</p></div></div><div className="table-wrap"><table><thead><tr><th>Original record</th><th>Requested by</th><th>Reason</th><th>Proposed changes</th><th>Status</th>{role === 'admin' && <th>Review</th>}</tr></thead><tbody>{data.map((amendment) => <tr key={amendment.id}><td>{amendment.referenceNumber || amendment.originalRecordId}</td><td>{users.find((user) => user.id === amendment.createdBy)?.name || amendment.createdBy}</td><td>{amendment.reason}</td><td>{Object.entries(amendment.proposedChanges || {}).map(([key, value]) => `${key}: ${value}`).join(', ')}</td><td><Status value={amendment.status}/>{amendment.reviewNote && <small className="review-note">{amendment.reviewNote}</small>}</td>{role === 'admin' && <td>{amendment.status === 'Pending Review' ? <div className="inline-actions"><button className="approve-button" onClick={() => onReview(amendment, 'Approved')}>Approve</button><button className="reject-button" onClick={() => onReview(amendment, 'Rejected')}>Reject</button></div> : '—'}</td>}</tr>)}</tbody></table>{data.length === 0 && <p className="empty-state">No amendment requests found.</p>}</div></section> }
function Employees({ data, onReset, loading }) {
  const employees = data.filter((person) => person.role === 'employee')
  return <><section className="panel"><h3>Managing staff on the free Firebase plan</h3><p>Create or disable Authentication accounts in Firebase Console. Then add or update the matching <code>users/{'{uid}'}</code> profile in Firestore with <code>role: "employee"</code> and <code>status: "active"</code>. This app cannot administer Firebase Authentication accounts without a paid backend.</p></section><section className="panel table-panel"><div className="table-toolbar"><div><h3>Team members</h3><p>{employees.length} employees</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Employee ID</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><div className="employee"><div className="employee-avatar">{(employee.name || employee.email || 'U').split(' ').map((part) => part[0]).join('')}</div><div><strong>{employee.name || 'Employee'}</strong><span>{employee.email}</span></div></div></td><td>{employee.id.slice(0, 8)}</td><td>Employee</td><td><Status value={employee.status === 'disabled' ? 'Inactive' : 'Active'}/></td><td><button disabled={loading || !employee.email} onClick={() => onReset(employee.email)}>Send password reset</button></td></tr>)}</tbody></table>{employees.length === 0 && <p className="empty-state">No employees found.</p>}</div></section></>
}

function Tasks({ data, employees, role, onStatus }) {
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 9
  const filtered = data.filter((task) => (status === 'all' || (task.status || 'To Do') === status) && (priority === 'all' || (task.priority || 'Normal') === priority))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  return <><div className="task-filters"><span>{filtered.length} tasks</span><select aria-label="Filter tasks by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="all">All statuses</option>{['To Do', 'In Progress', 'Waiting', 'Completed'].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Filter tasks by priority" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1) }}><option value="all">All priorities</option>{['Low', 'Normal', 'High', 'Urgent'].map((value) => <option key={value}>{value}</option>)}</select></div><section className="task-grid">{visible.map((task)=><article className="task-card" key={task.id}><div><Status value={task.status || 'To Do'}/></div><h3>{task.title}</h3><p>{employees.find((person) => person.id === task.assignedTo)?.name || task.assignedTo || 'Unassigned'} · {task.priority || 'Normal'} priority</p><footer><span><Clock3 size={14}/>{dateLabel(task.dueDate)}</span>{role === 'employee' && task.status !== 'Completed' && <select aria-label={`Update status for ${task.title}`} value={task.status || 'To Do'} onChange={(event) => onStatus(task, event.target.value)}><option>To Do</option><option>In Progress</option><option>Waiting</option><option>Completed</option></select>}</footer></article>)}</section>{filtered.length === 0 && <p className="empty-state">No tasks match the selected filters.</p>}<Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage}/></>
}

function CreateModal({ page, accounts, employees, defaultCurrency, onClose, onSubmit, loading }) {
  const [values, setValues] = useState({ currency: defaultCurrency, type: 'Business', priority: 'Normal' })
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const isAccount = page === 'Accounts'
  const isPayment = page === 'Payment Records'
  const title = isAccount ? 'Create account' : isPayment ? 'Add payment record' : 'Create task'
  const submit = (event) => {
    event.preventDefault()
    onSubmit(values)
  }
  const textField = (key, label, props = {}) => <label>{label}<input required={props.required !== false} type={props.type || 'text'} value={values[key] || ''} onChange={set(key)} {...props}/></label>
  const selectField = (key, label, options) => <label>{label}<select required value={values[key] || ''} onChange={set(key)}><option value="">Select…</option>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>

  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><form onSubmit={submit}>
    <div className="modal-heading"><div><span>New entry</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></div>
    <div className="form-grid">
      {isAccount && <>{textField('name', 'Account name')}{selectField('type', 'Account type', [['Business','Business'],['Enterprise','Enterprise'],['Individual','Individual']])}{selectField('assignedTo', 'Assign employee', employees.filter((person) => person.role === 'employee' && person.status !== 'disabled').map((person) => [person.id, person.name || person.email]))}{textField('contactName', 'Contact name', { required: false })}{textField('contactEmail', 'Contact email', { type: 'email', required: false })}<label className="full">Internal notes<textarea value={values.notes || ''} onChange={set('notes')}/></label></>}
      {isPayment && <>{selectField('accountId', 'Account', accounts.map((account) => [account.id, account.name]))}{textField('amount', 'Amount', { type: 'number', min: '0.01', step: '0.01' })}{selectField('currency', 'Currency', [['USD','USD'],['EUR','EUR'],['GBP','GBP']])}{textField('category', 'Category')}{textField('referenceNumber', 'Reference number')}{textField('date', 'Record date', { type: 'date' })}<label className="full">Notes<textarea value={values.notes || ''} onChange={set('notes')}/></label></>}
      {!isAccount && !isPayment && <>{textField('name', 'Task title')}{selectField('assignedTo', 'Assign to', employees.filter((person) => person.role === 'employee' && person.status !== 'disabled').map((person) => [person.id, person.name || person.email]))}{selectField('priority', 'Priority', [['Low','Low'],['Normal','Normal'],['High','High'],['Urgent','Urgent']])}{textField('dueDate', 'Due date', { type: 'date' })}<label className="full">Description<textarea value={values.notes || ''} onChange={set('notes')}/></label></>}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={loading}>{loading ? 'Saving…' : 'Create'}</button></div>
  </form></section></div>
}

function AmendmentModal({ record, onClose, onSubmit, loading }) {
  const [values, setValues] = useState({
    amount: String(record.amount ?? ''),
    currency: record.currency || 'USD',
    category: record.category || '',
    referenceNumber: record.referenceNumber || '',
    notes: record.notes || '',
    reason: '',
  })
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><form onSubmit={(event) => { event.preventDefault(); onSubmit(values) }}>
    <div className="modal-heading"><div><span>Controlled change request</span><h2>Request payment amendment</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></div>
    <div className="form-grid"><label>Amount<input type="number" min="0.01" step="0.01" required value={values.amount} onChange={set('amount')}/></label><label>Currency<select value={values.currency} onChange={set('currency')}><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Category<input required value={values.category} onChange={set('category')}/></label><label>Reference number<input required value={values.referenceNumber} onChange={set('referenceNumber')}/></label><label className="full">Proposed notes<textarea value={values.notes} onChange={set('notes')}/></label><label className="full">Reason for correction<textarea required value={values.reason} onChange={set('reason')}/></label></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={loading}>{loading ? 'Submitting…' : 'Submit request'}</button></div>
  </form></section></div>
}

function CorrectionModal({ record, accounts, onClose, onSubmit, loading }) {
  const [values, setValues] = useState({
    accountId: record.accountId || '',
    amount: String(record.amount ?? ''),
    currency: record.currency || 'USD',
    category: record.category || '',
    referenceNumber: record.referenceNumber || '',
    notes: record.notes || '',
  })
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><form onSubmit={(event) => { event.preventDefault(); onSubmit(values) }}>
    <div className="modal-heading"><div><span>Update requested fields</span><h2>Resubmit payment record</h2><p>{record.reviewNote}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></div>
    <div className="form-grid"><label>Account<select required value={values.accountId} onChange={set('accountId')}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label><label>Amount<input type="number" min="0.01" step="0.01" required value={values.amount} onChange={set('amount')}/></label><label>Currency<select value={values.currency} onChange={set('currency')}><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Category<input required value={values.category} onChange={set('category')}/></label><label>Reference number<input required value={values.referenceNumber} onChange={set('referenceNumber')}/></label><label className="full">Notes<textarea value={values.notes} onChange={set('notes')}/></label></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={loading}>{loading ? 'Submitting…' : 'Resubmit for review'}</button></div>
  </form></section></div>
}

function EditAccountModal({ account, employees, onClose, onSubmit, loading }) {
  const [values, setValues] = useState({
    name: account.name || '',
    type: account.type || 'Business',
    status: account.status || 'Active',
    assignedTo: account.assignedEmployees?.[0] || '',
    notes: account.notes || '',
  })
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><form onSubmit={(event) => { event.preventDefault(); onSubmit(values) }}>
    <div className="modal-heading"><div><span>{account.id}</span><h2>Edit account</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></div>
    <div className="form-grid"><label>Account name<input required value={values.name} onChange={set('name')}/></label><label>Type<select value={values.type} onChange={set('type')}><option>Business</option><option>Enterprise</option><option>Individual</option></select></label><label>Status<select value={values.status} onChange={set('status')}><option>Active</option><option>Inactive</option><option>Review</option><option>Archived</option></select></label><label>Assigned employee<select value={values.assignedTo} onChange={set('assignedTo')}><option value="">Unassigned</option>{employees.filter((person) => person.role === 'employee' && person.status !== 'disabled').map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}</select></label><label className="full">Internal notes<textarea value={values.notes} onChange={set('notes')}/></label></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={loading}>{loading ? 'Saving…' : 'Save account'}</button></div>
  </form></section></div>
}

function Messages({ conversations, users, session, onStart }) {
  const [selectedId, setSelectedId] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const selected = conversations.find((item) => item.id === selectedId) || conversations[0]
  useEffect(() => {
    if (!selected?.id) return undefined
    return subscribeToMessages(selected.id, setMessages, (reason) => setError(reason.message))
  }, [selected?.id])
  const send = async (event) => {
    event.preventDefault()
    if (!draft.trim() || !selected?.id) return
    try {
      await sendConversationMessage(selected.id, draft.trim(), session)
      setDraft('')
      setError('')
    } catch (reason) {
      setError(reason.message)
    }
  }
  const names = selected?.participantNames || {}
  const otherName = selected ? Object.entries(names).find(([uid]) => uid !== session.uid)?.[1] || 'Conversation' : 'Select a conversation'
  return <section className="messages-layout"><aside><div className="conversation-search"><Search size={16}/><input placeholder="Conversations"/></div>{conversations.map((conversation) => { const other = Object.entries(conversation.participantNames || {}).find(([uid]) => uid !== session.uid)?.[1] || 'Conversation'; return <button className={`conversation ${selected?.id === conversation.id ? 'selected' : ''}`} key={conversation.id} onClick={() => setSelectedId(conversation.id)}><div className="employee-avatar">{other.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><div><strong>{other}</strong><span>{conversation.lastMessage || 'No messages yet'}</span></div></button> })}</aside><div className="chat"><header><strong>{otherName}</strong><span>Internal conversation</span></header><div className="chat-body">{error && <p className="app-error">{error}</p>}{messages.map((message) => <div key={message.id} className={`bubble ${message.senderId === session.uid ? 'mine' : 'theirs'}`}><small>{message.senderId === session.uid ? session.name : otherName} · {dateLabel(message.createdAt)}</small><br/>{message.text}</div>)}{messages.length === 0 && <p className="empty-state">Choose a conversation to view messages.</p>}</div><form className="chat-footer" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={selected ? 'Write a message…' : 'Select a conversation'} disabled={!selected}/><button disabled={!selected || !draft.trim()} aria-label="Send message"><Send size={17}/></button></form></div>{session.role === 'admin' && <NewConversation users={users} onStart={onStart}/>}</section>
}

function NewConversation({ users, onStart }) {
  const [recipientId, setRecipientId] = useState('')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  return <div className="new-conversation"><button className="primary" onClick={() => setOpen(!open)}>New message</button>{open && <form onSubmit={(event) => { event.preventDefault(); onStart({ recipientId, message }); setOpen(false) }}><select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} required><option value="">Select employee</option>{users.filter((user) => user.role === 'employee' && user.status !== 'disabled').map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}</select><textarea value={message} onChange={(event) => setMessage(event.target.value)} required placeholder="Write your message"/><button className="primary" type="submit">Start conversation</button></form>}</div>
}

function reportValue(value) {
  if (value == null) return ''
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString()
  if (Array.isArray(value)) return value.map(reportValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function Reports({ preview, onClosePreview, onPrint, onExport }) {
  const reports = [
    ['paymentRecords', 'Payment records', 'Approved, pending and rejected records'],
    ['accounts', 'Accounts', 'Account directory and status'],
    ['tasks', 'Tasks', 'Assignments, priorities and due dates'],
  ]
  const columns = preview
    ? [...new Set(preview.records.flatMap((record) => Object.keys(record)))]
      .filter((key) => !['history', 'metadata', 'proposedChanges'].includes(key))
      .slice(0, 10)
    : []
  return <><div className="report-cards">{reports.map(([key, title, description]) => <article key={key}><FileText/><div><h3>{title}</h3><p>{description}</p></div><div className="inline-actions"><button className="filter-button" onClick={() => onPrint(key)}>Preview / PDF</button><button className="filter-button" onClick={() => onExport(key)}>Export CSV</button></div></article>)}</div><section className="panel"><p>Reports use currently authorized Firestore records, limited to 5,000 rows. CSV exports contain full record fields; print reports are formatted for saving as PDF.</p></section>{preview && <section className="print-preview"><div className="print-actions"><button className="primary" onClick={() => window.print()}>Print / Save as PDF</button><button className="secondary" onClick={onClosePreview}>Close preview</button></div><header><h2>{reports.find(([key]) => key === preview.name)?.[1] || preview.name}</h2><p>{preview.records.length} records · Generated {preview.generatedAt.toLocaleString()}</p></header><div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.records.map((record, index) => <tr key={record.id || index}>{columns.map((column) => <td key={column}>{reportValue(record[column])}</td>)}</tr>)}</tbody></table></div></section>}</>
}
function SettingsPage({ settings, onSave }) { const [name, setName] = useState(settings.name || 'TRX FLOW'); const [currency, setCurrency] = useState(settings.currency || 'USD'); return <section className="settings-grid"><form className="panel" onSubmit={(event) => { event.preventDefault(); onSave({ name, currency }) }}><h3>Organization</h3><label>System name<input value={name} onChange={(event) => setName(event.target.value)} required/></label><label>Default currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound Sterling</option></select></label><button className="primary">Save changes</button></form><article className="panel"><h3>Free Firebase services</h3><div className="setting-row"><div><strong>Authentication</strong><span>Email/password provider (enable in Firebase Console)</span></div></div><div className="setting-row"><div><strong>Firestore</strong><span>Within Firebase Spark daily quotas</span></div></div><div className="setting-row"><div><strong>Files and server automation</strong><span>Not included on Spark; file uploads and automatic reminders are unavailable.</span></div></div></article></section> }
function Health({ firebaseEnabled, dataError, lastSync }) { const services=[['Firebase Authentication',firebaseEnabled ? 'Configured' : 'Unavailable'],['Firestore Database',dataError ? 'Degraded' : 'Configured'],['Firebase Hosting','Deploy separately'],['Last successful sync',lastSync ? lastSync.toLocaleTimeString() : 'Waiting']]; return <section className="health-grid">{services.map(([name,status])=><article className="panel health-card" key={name}><div className="health-icon"><CheckCircle2 size={20}/></div><div><h3>{name}</h3><p>{status}</p></div></article>)}</section> }
