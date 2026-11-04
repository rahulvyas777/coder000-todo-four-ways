import { useEffect, useEffectEvent, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useMatch, useNavigate, useParams } from 'react-router'
import { api, type Repeat, type Subtask, type TaskChanges, type TaskItem, type TaskList } from './api'

export default function App() {
  const [lists, setLists] = useState<TaskList[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .lists(ctrl.signal)
      .then(setLists)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(String(e))
      })
    return () => ctrl.abort()
  }, [])

  // One undo toast at a time: a new action replaces it (and restarts its five seconds).
  const [toast, setToast] = useState<Toast | null>(null)
  const toastSeq = useRef(0)
  const toastId = toast?.id

  useEffect(() => {
    if (toastId === undefined) return
    const timer = setTimeout(() => setToast((t) => (t?.id === toastId ? null : t)), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toastId])

  const showToast: ShowToast = (message, undo) => setToast({ id: ++toastSeq.current, message, undo })

  // Bumped after an undo so the list view refetches its tasks from the server.
  const [reloadKey, setReloadKey] = useState(0)

  async function runUndo(t: Toast) {
    setToast(null)
    await t.undo()
    setLists(await api.lists())
    setReloadKey((k) => k + 1)
  }

  // `?` toggles the shortcut help from anywhere but a text field; Escape closes it first, before
  // the panel and selection listeners (they skip an Escape whose default is prevented).
  const [helpOpen, setHelpOpen] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && helpOpen) {
        e.preventDefault()
        setHelpOpen(false)
      } else if (e.key === '?' && !hasModifier(e) && !isTyping(e.target)) {
        e.preventDefault()
        setHelpOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [helpOpen])

  return (
    <div className="app">
      <Sidebar lists={lists ?? []} setLists={setLists} showToast={showToast} />
      <Routes>
        <Route path="/" element={<Home lists={lists} error={error} />} />
        {/* One route for the list and its panel, so opening the panel never remounts the list. */}
        <Route
          path="/lists/:listId/*"
          element={<ListView lists={lists ?? []} setLists={setLists} showToast={showToast} reloadKey={reloadKey} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {toast && (
        <div className="toast" data-testid="toast" role="status">
          <span>{toast.message}</span>
          <button type="button" data-testid="toast-undo" onClick={() => void runUndo(toast)}>
            Undo
          </button>
        </div>
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

const TOAST_MS = 5000

const SHORTCUTS: [keys: string[], action: string][] = [
  [['n'], 'Add a task'],
  [['/'], 'Search'],
  [['j', 'k'], 'Move the highlight down / up'],
  [['x'], 'Complete or reopen the highlighted task'],
  [['Del'], 'Delete the highlighted task'],
  [['Enter'], 'Open the highlighted task'],
  [['Esc'], 'Close the panel or clear the selection'],
  [['?'], 'Show or hide this help'],
]

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="shortcut-help"
      data-testid="shortcut-help"
      aria-labelledby="shortcut-help-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action} style={{ display: 'contents' }}>
            <dt>
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && ' / '}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  )
}

function hasModifier(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}

/** Shortcuts are ignored while the user types in a field. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'))
}

type Toast = { id: number; message: string; undo: () => Promise<unknown> }
type ShowToast = (message: string, undo: () => Promise<unknown>) => void

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`/icons.svg#${name}`} />
    </svg>
  )
}

type SetLists = Dispatch<SetStateAction<TaskList[] | null>>

function Sidebar({ lists, setLists, showToast }: { lists: TaskList[]; setLists: SetLists; showToast: ShowToast }) {
  // The sidebar sits outside <Routes>, so useParams() would be empty here.
  const match = useMatch('/lists/:listId/*')
  const activeId = Number(match?.params.listId)
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  async function addList(name: string) {
    setAdding(false)
    const created = await api.createList(name)
    setLists((prev) => [...(prev ?? []), created])
    navigate(`/lists/${created.id}`)
  }

  async function renameList(id: number, name: string) {
    setEditingId(null)
    const updated = await api.updateList(id, { name })
    setLists((prev) => prev?.map((l) => (l.id === id ? { ...l, ...updated } : l)) ?? null)
  }

  async function deleteList(list: TaskList) {
    if (!window.confirm(`Delete the list "${list.name}" and its tasks?`)) return
    await api.deleteList(list.id)
    setLists((prev) => prev?.filter((l) => l.id !== list.id) ?? null)
    const wasActive = list.id === activeId
    if (wasActive) navigate('/', { replace: true })
    showToast(`Deleted list "${list.name}"`, async () => {
      await api.restoreList(list.id)
      if (wasActive) navigate(`/lists/${list.id}`)
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h1 className="app-title" data-testid="app-title">
          Tasks
        </h1>
      </div>
      <nav aria-label="Lists">
        <ul className="list-nav" data-testid="list-nav">
          {lists.map((l) => (
            <li
              key={l.id}
              className={`list-item${l.id === activeId ? ' active' : ''}`}
              data-testid={`list-item-${l.id}`}
            >
              {editingId === l.id ? (
                <NameEditor
                  label={`Rename list ${l.name}`}
                  initial={l.name}
                  onSave={(name) => void renameList(l.id, name)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <Link
                    to={`/lists/${l.id}`}
                    aria-current={l.id === activeId ? 'page' : undefined}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      setEditingId(l.id)
                    }}
                  >
                    <span>{l.name}</span>
                    <span className="list-count" data-testid={`list-count-${l.id}`} title="Open tasks">
                      {l.openCount}
                    </span>
                  </Link>
                  <span className="list-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      data-testid={`list-rename-${l.id}`}
                      aria-label={`Rename list ${l.name}`}
                      title="Rename"
                      onClick={() => setEditingId(l.id)}
                    >
                      <Icon name="i-edit" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-danger"
                      data-testid={`list-delete-${l.id}`}
                      aria-label={`Delete list ${l.name}`}
                      title="Delete"
                      onClick={() => void deleteList(l)}
                    >
                      <Icon name="i-trash" />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="list-add-row">
        {adding ? (
          <NameEditor
            label="New list name"
            initial=""
            placeholder="List name"
            testId="list-name-input"
            onSave={(name) => void addList(name)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" data-testid="list-add" onClick={() => setAdding(true)}>
            <Icon name="i-plus" />
            New list
          </button>
        )}
      </div>
    </aside>
  )
}

/** Inline name field: Enter or blur saves a non-empty changed name, Escape cancels. */
function NameEditor(props: {
  label: string
  initial: string
  placeholder?: string
  testId?: string
  maxLength?: number
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const done = useRef(false)

  function finish(value: string | null) {
    if (done.current) return
    done.current = true
    const name = value?.trim() ?? ''
    if (name && name !== props.initial) props.onSave(name)
    else props.onCancel()
  }

  return (
    <input
      type="text"
      autoFocus
      maxLength={props.maxLength ?? 80}
      defaultValue={props.initial}
      placeholder={props.placeholder}
      aria-label={props.label}
      data-testid={props.testId}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') {
          // Escape here only cancels the edit; it must not also close the panel.
          e.preventDefault()
          finish(null)
        }
      }}
    />
  )
}

function Home({ lists, error }: { lists: TaskList[] | null; error: string | null }) {
  if (lists && lists.length > 0) return <Navigate to={`/lists/${lists[0].id}`} replace />
  return (
    <main className="main">
      <p className="empty-state">{error ?? (lists ? 'No lists yet' : 'Loading…')}</p>
    </main>
  )
}

function ListView({
  lists,
  setLists,
  showToast,
  reloadKey,
}: {
  lists: TaskList[]
  setLists: SetLists
  showToast: ShowToast
  reloadKey: number
}) {
  const listId = Number(useParams().listId)
  const list = lists.find((l) => l.id === listId)
  const taskMatch = useMatch('/lists/:listId/tasks/:taskId')
  const openId = taskMatch ? Number(taskMatch.params.taskId) : null
  const navigate = useNavigate()
  const { search } = useLocation()
  const [loaded, setLoaded] = useState<{ listId: number; tasks: TaskItem[] } | null>(null)

  function setTasks(fn: (tasks: TaskItem[]) => TaskItem[]) {
    setLoaded((prev) => (prev?.listId === listId ? { listId, tasks: fn(prev.tasks) } : prev))
  }

  /** Keeps the sidebar counts in step with the changes made here, without refetching the lists. */
  function adjustCounts(dTotal: number, dOpen: number) {
    setLists(
      (prev) =>
        prev?.map((l) =>
          l.id === listId ? { ...l, taskCount: l.taskCount + dTotal, openCount: l.openCount + dOpen } : l,
        ) ?? null,
    )
  }

  function replaceTask(task: TaskItem) {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)))
  }

  async function addTask(title: string) {
    const created = await api.createTask(listId, title)
    setTasks((ts) => [...ts, created])
    adjustCounts(1, created.completed ? 0 : 1)
  }

  function setCompleted(id: number, completed: boolean) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, completed } : t)))
    adjustCounts(0, completed ? -1 : 1)
  }

  /** Optimistic: the row changes at once (and may leave the view), then takes the server's version. */
  async function toggleTask(task: TaskItem) {
    const want = !task.completed
    setCompleted(task.id, want)
    try {
      const updated = want ? (await api.completeTask(task.id)).task : await api.reopenTask(task.id)
      replaceTask(updated)
      if (updated.completed !== want) adjustCounts(0, updated.completed ? -1 : 1)
    } catch {
      setCompleted(task.id, task.completed)
    }
  }

  async function renameTask(task: TaskItem, title: string) {
    replaceTask(await api.updateTask(task.id, { title }))
  }

  /** Shows the change at once, then the server's version of the task. */
  async function editTask(task: TaskItem, changes: TaskChanges) {
    replaceTask({ ...task, ...changes })
    replaceTask(await api.updateTask(task.id, changes))
  }

  /** Applies a change to one task's subtasks; the task itself (completed included) is untouched. */
  function setSubtasks(taskId: number, fn: (subs: Subtask[]) => Subtask[]) {
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, subtasks: fn(t.subtasks) } : t)))
  }

  async function addSubtask(taskId: number, title: string) {
    const created = await api.addSubtask(taskId, title)
    setSubtasks(taskId, (subs) => [...subs, created])
  }

  async function toggleSubtask(sub: Subtask) {
    setSubtasks(sub.taskId, (subs) => subs.map((s) => (s.id === sub.id ? { ...s, done: !sub.done } : s)))
    const updated = await api.updateSubtask(sub.id, { done: !sub.done })
    setSubtasks(sub.taskId, (subs) => subs.map((s) => (s.id === sub.id ? updated : s)))
  }

  async function deleteSubtask(sub: Subtask) {
    await api.deleteSubtask(sub.id)
    setSubtasks(sub.taskId, (subs) => subs.filter((s) => s.id !== sub.id))
  }

  function openTask(id: number) {
    if (id !== openId) navigate(`/lists/${listId}/tasks/${id}${search}`)
  }

  function closePanel() {
    navigate(`/lists/${listId}${search}`)
  }

  async function deleteTask(task: TaskItem) {
    await api.deleteTask(task.id)
    setTasks((ts) => ts.filter((t) => t.id !== task.id))
    adjustCounts(-1, task.completed ? 0 : -1)
    showToast(`Deleted "${task.title}"`, () => api.restoreTask(task.id))
  }

  // Drag-and-drop reorder, hand-rolled on the native HTML5 drag events (no library).
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<DropAt | null>(null)

  function endDrag() {
    setDragId(null)
    setDropAt(null)
  }

  /** Moves the dragged task next to the target in the full list (hidden tasks keep their places). */
  async function dropTask(target: DropAt) {
    const fromId = dragId
    endDrag()
    if (!tasks || fromId === null || fromId === target.id) return
    const moved = tasks.find((t) => t.id === fromId)
    if (!moved) return
    const rest = tasks.filter((t) => t.id !== fromId)
    const at = rest.findIndex((t) => t.id === target.id) + (target.where === 'after' ? 1 : 0)
    const next = [...rest.slice(0, at), moved, ...rest.slice(at)]
    if (next.every((t, i) => t === tasks[i])) return
    setTasks(() => next)
    try {
      await api.reorderTasks(listId, next.map((t) => t.id))
    } catch {
      // Fall back to the server's order when the reorder is rejected.
      setLoaded({ listId, tasks: await api.tasks(listId) })
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .tasks(listId, ctrl.signal)
      .then((tasks) => setLoaded({ listId, tasks }))
      .catch(() => {
        if (!ctrl.signal.aborted) setLoaded({ listId, tasks: [] })
      })
    return () => ctrl.abort()
  }, [listId, reloadKey])

  // Rows of a previous list are never shown while the next one loads.
  const tasks = loaded?.listId === listId ? loaded.tasks : null
  const open = tasks?.filter((t) => !t.completed).length ?? 0
  const openTaskItem = tasks?.find((t) => t.id === openId)

  const params = new URLSearchParams(search)
  const view = parseView(params.get('view'))
  const today = todayIso()
  const sort = parseSort(params.get('sort'))

  // The search box keeps its own state so typing never waits for the router's (transition)
  // update of the URL; the URL follows, and an outside URL change (back, a link) resets the box.
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const pushedQuery = useRef(urlQuery)
  useEffect(() => {
    if (urlQuery !== pushedQuery.current) {
      pushedQuery.current = urlQuery
      setQuery(urlQuery)
    }
  }, [urlQuery])

  const needle = query.trim().toLowerCase()
  const visible = tasks
    ? sortTasks(
        tasks.filter((t) => VIEWS[view].test(t, today) && matchesSearch(t, needle)),
        sort,
      )
    : null

  function setParam(name: string, value: string | null, replace = false) {
    const p = new URLSearchParams(search)
    if (value === null) p.delete(name)
    else p.set(name, value)
    const qs = p.toString()
    navigate({ search: qs ? `?${qs}` : '' }, { replace })
  }

  // Bulk selection, tagged with its list so switching lists starts with nothing selected.
  const [selection, setSelection] = useState<{ listId: number; ids: ReadonlySet<number> }>({ listId, ids: new Set() })
  const selected = selection.listId === listId ? selection.ids : NO_IDS
  const [moveTarget, setMoveTarget] = useState<number | null>(null)
  const otherLists = lists.filter((l) => l.id !== listId)
  const target = otherLists.find((l) => l.id === moveTarget)?.id ?? otherLists[0]?.id
  const allSelected = !!visible && visible.length > 0 && visible.every((t) => selected.has(t.id))

  function setSelected(ids: ReadonlySet<number>) {
    setSelection({ listId, ids })
  }

  function toggleSelected(id: number) {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }

  function toggleSelectAll() {
    setSelected(allSelected ? NO_IDS : new Set(visible?.map((t) => t.id)))
  }

  // Escape clears the selection unless an inline editor already handled it.
  const hasSelection = selected.size > 0
  useEffect(() => {
    if (!hasSelection) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) setSelection({ listId, ids: NO_IDS })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hasSelection, listId])

  // Keyboard cursor moved by j/k, tagged with its list like the selection.
  const [cursor, setCursor] = useState<{ listId: number; id: number | null }>({ listId, id: null })
  const highlightId = cursor.listId === listId ? cursor.id : null
  const addInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || hasModifier(e) || isTyping(e.target)) return
    const rows = visible ?? []
    const at = rows.findIndex((t) => t.id === highlightId)
    const current = at >= 0 ? rows[at] : undefined
    switch (e.key) {
      case 'n':
        addInput.current?.focus()
        break
      case '/':
        searchInput.current?.focus()
        break
      case 'j':
      case 'k': {
        if (rows.length === 0) return
        const step = e.key === 'j' ? 1 : -1
        const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(Math.max(at + step, 0), rows.length - 1)
        setCursor({ listId, id: rows[next].id })
        document.querySelector(`[data-testid="task-row-${rows[next].id}"]`)?.scrollIntoView({ block: 'nearest' })
        break
      }
      case 'x':
        if (!current) return
        void toggleTask(current)
        break
      case 'Delete':
        if (!current) return
        setCursor({ listId, id: rows[at + 1]?.id ?? rows[at - 1]?.id ?? null })
        void deleteTask(current)
        break
      case 'Enter':
        // Enter on a focused button or link keeps its own meaning.
        if (!current || (e.target instanceof HTMLElement && e.target.closest('button, a'))) return
        openTask(current.id)
        break
      default:
        return
    }
    e.preventDefault()
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onShortcut(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /** Runs a bulk action on the selected tasks of this list, then clears the selection. */
  async function runBulk(action: 'complete' | 'delete' | 'move') {
    if (!tasks) return
    const ids = tasks.filter((t) => selected.has(t.id)).map((t) => t.id)
    if (ids.length === 0 || (action === 'move' && target === undefined)) return
    setSelected(NO_IDS)
    const picked = new Set(ids)
    // Undo reopens only the tasks this action completed, not those that already were.
    const reopenIds = tasks.filter((t) => picked.has(t.id) && !t.completed).map((t) => t.id)
    if (action === 'complete') setTasks((ts) => ts.map((t) => (picked.has(t.id) ? { ...t, completed: true } : t)))
    else setTasks((ts) => ts.filter((t) => !picked.has(t.id)))
    try {
      await api.bulk(ids, action, action === 'move' ? target : undefined)
      const n = `${ids.length} task${ids.length === 1 ? '' : 's'}`
      if (action === 'delete') showToast(`Deleted ${n}`, () => api.bulk(ids, 'restore'))
      else if (action === 'complete') showToast(`Completed ${n}`, () => api.bulk(reopenIds, 'reopen'))
    } finally {
      // The server's state wins: completing a repeating task creates its next occurrence, and the
      // sidebar counts of this list (and of the move target) change.
      const [fresh, freshLists] = await Promise.all([api.tasks(listId), api.lists()])
      setLoaded((prev) => (prev?.listId === listId ? { listId, tasks: fresh } : prev))
      setLists(freshLists)
    }
  }

  function selectView(next: View) {
    setParam('view', next === 'all' ? null : next)
  }

  // Filters on every keystroke with no debounce on purpose: the comparison measures rendering.
  function changeQuery(next: string) {
    setQuery(next)
    pushedQuery.current = next
    setParam('q', next === '' ? null : next, true)
  }

  return (
    <>
    <main className="main">
      <div className="main-head">
        <h2>{list?.name ?? ''}</h2>
        <span className="task-count" data-testid="task-count" aria-live="polite">
          {tasks ? `${open.toLocaleString()} of ${tasks.length.toLocaleString()} open` : ''}
        </span>
      </div>
      <form
        className="task-add"
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement
          const title = input.value.trim()
          input.value = ''
          if (title) void addTask(title)
        }}
      >
        <input
          type="text"
          name="title"
          maxLength={200}
          placeholder="Add a task"
          aria-label="Add a task"
          data-testid="task-add-input"
          ref={addInput}
          disabled={!tasks}
        />
      </form>
      <div className="toolbar">
        <input
          type="checkbox"
          className="select-check"
          data-testid="select-all"
          aria-label="Select all visible tasks"
          title="Select all"
          checked={allSelected}
          disabled={!visible || visible.length === 0}
          onChange={toggleSelectAll}
        />
        <div className="filter-bar" role="group" aria-label="Filter tasks">
          {VIEW_ORDER.map((v) => (
            <button
              key={v}
              type="button"
              className={`filter${v === view ? ' active' : ''}`}
              aria-pressed={v === view}
              data-testid={`filter-${v}`}
              onClick={() => selectView(v)}
            >
              {VIEWS[v].label} <span className="count">{tasks ? tasks.filter((t) => VIEWS[v].test(t, today)).length : ''}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <input
            type="search"
            placeholder="Search tasks"
            aria-label="Search tasks"
            data-testid="search-input"
            ref={searchInput}
            value={query}
            onChange={(e) => changeQuery(e.currentTarget.value)}
          />
        </div>
        <div className="sort">
          <select
            aria-label="Sort by"
            data-testid="sort-select"
            value={sort}
            onChange={(e) => setParam('sort', e.currentTarget.value === 'manual' ? null : e.currentTarget.value)}
          >
            {SORT_ORDER.map((s) => (
              <option key={s} value={s}>
                {SORTS[s].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="bulk-bar" data-testid="bulk-bar" role="region" aria-label="Bulk actions">
          <span className="bulk-count" data-testid="bulk-count" aria-live="polite">
            {selected.size} selected
          </span>
          <button type="button" data-testid="bulk-complete" onClick={() => void runBulk('complete')}>
            <Icon name="i-check" />
            Complete
          </button>
          <button type="button" className="btn-danger" data-testid="bulk-delete" onClick={() => void runBulk('delete')}>
            <Icon name="i-trash" />
            Delete
          </button>
          <select
            aria-label="Move to list"
            data-testid="bulk-move-target"
            value={target ?? ''}
            disabled={otherLists.length === 0}
            onChange={(e) => setMoveTarget(Number(e.currentTarget.value))}
          >
            {otherLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="bulk-move"
            disabled={target === undefined}
            onClick={() => void runBulk('move')}
          >
            Move
          </button>
        </div>
      )}
      <div className="rows-container" data-testid="rows-container">
        {visible?.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            isOpen={t.id === openId}
            highlighted={t.id === highlightId}
            selected={selected.has(t.id)}
            onSelect={() => toggleSelected(t.id)}
            drag={
              sort === 'manual'
                ? {
                    dragging: t.id === dragId,
                    dropAt: dropAt?.id === t.id ? dropAt.where : null,
                    onStart: () => setDragId(t.id),
                    onOver: (where) => {
                      if (dropAt?.id !== t.id || dropAt.where !== where) setDropAt({ id: t.id, where })
                    },
                    onDrop: (where) => void dropTask({ id: t.id, where }),
                    onEnd: endDrag,
                  }
                : null
            }
            onOpen={() => openTask(t.id)}
            onToggle={() => void toggleTask(t)}
            onRename={(title) => void renameTask(t, title)}
            onDelete={() => void deleteTask(t)}
          />
        ))}
        {visible?.length === 0 && <p className="empty-state">Nothing here</p>}
      </div>
    </main>
    {openTaskItem && (
      <TaskPanel
        key={openTaskItem.id}
        task={openTaskItem}
        onChange={(changes) => void editTask(openTaskItem, changes)}
        onAddSubtask={(title) => void addSubtask(openTaskItem.id, title)}
        onToggleSubtask={(sub) => void toggleSubtask(sub)}
        onDeleteSubtask={(sub) => void deleteSubtask(sub)}
        onClose={closePanel}
      />
    )}
    </>
  )
}

const NO_IDS: ReadonlySet<number> = new Set()

type DropWhere = 'before' | 'after'
type DropAt = { id: number; where: DropWhere }

/** Drag state and callbacks of a row; null outside the manual sort, which hides the handle. */
type RowDrag = {
  dragging: boolean
  dropAt: DropWhere | null
  onStart: () => void
  onOver: (where: DropWhere) => void
  onDrop: (where: DropWhere) => void
  onEnd: () => void
}

/** The upper half of a row drops before it, the lower half after it. */
function dropWhere(e: DragEvent<HTMLElement>): DropWhere {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after'
}

function TaskRow(props: {
  task: TaskItem
  isOpen: boolean
  highlighted: boolean
  selected: boolean
  onSelect: () => void
  drag: RowDrag | null
  onOpen: () => void
  onToggle: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const { task, drag } = props
  const [editing, setEditing] = useState(false)

  return (
    <div
      className={`task-row${task.completed ? ' completed' : ''}${isOverdue(task) ? ' overdue' : ''}${props.isOpen ? ' open' : ''}${props.highlighted ? ' highlighted' : ''}${props.selected ? ' selected' : ''}${drag?.dragging ? ' dragging' : ''}${drag?.dropAt ? ` drop-${drag.dropAt}` : ''}`}
      data-testid={`task-row-${task.id}`}
      onClick={(e) => {
        // Clicks on the row's own controls (checkbox, delete, title editor) do not open the panel.
        if (!(e.target as HTMLElement).closest('input, button, select, textarea, .drag-handle')) props.onOpen()
      }}
      onDragOver={
        drag
          ? (e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              drag.onOver(dropWhere(e))
            }
          : undefined
      }
      onDrop={
        drag
          ? (e) => {
              e.preventDefault()
              drag.onDrop(dropWhere(e))
            }
          : undefined
      }
    >
      {drag && (
        <span
          className="drag-handle"
          data-testid={`drag-handle-${task.id}`}
          draggable
          role="img"
          aria-label={`Drag to reorder ${task.title}`}
          title="Drag to reorder"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(task.id))
            const row = e.currentTarget.closest('.task-row')
            if (row) e.dataTransfer.setDragImage(row, 16, 20)
            drag.onStart()
          }}
          onDragEnd={drag.onEnd}
        >
          <Icon name="i-drag" />
        </span>
      )}
      <input
        type="checkbox"
        className="select-check"
        data-testid={`select-check-${task.id}`}
        checked={props.selected}
        onChange={props.onSelect}
        aria-label={`Select: ${task.title}`}
      />
      <input
        type="checkbox"
        className="task-check"
        data-testid={`task-check-${task.id}`}
        checked={task.completed}
        onChange={props.onToggle}
        aria-label={`Completed: ${task.title}`}
      />
      <span className="task-title" data-testid={`task-title-${task.id}`} onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <NameEditor
            label={`Edit title of ${task.title}`}
            initial={task.title}
            maxLength={200}
            onSave={(title) => {
              setEditing(false)
              props.onRename(title)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          task.title
        )}
      </span>
      <span className="task-meta">
        {task.subtasks.length > 0 && (
          <span
            className="subtask-progress"
            data-testid={`subtask-progress-${task.id}`}
            title={`${task.subtasks.filter((s) => s.done).length} of ${task.subtasks.length} subtasks done`}
          >
            {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
          </span>
        )}
        {task.tags.map((tag) => (
          <span key={tag} className="tag" data-testid={`task-tag-${task.id}-${tag}`}>
            {tag}
          </span>
        ))}
        {task.dueDate && (
          <time className="task-due" dateTime={task.dueDate} data-testid={`task-due-${task.id}`}>
            {formatDue(task.dueDate)}
          </time>
        )}
        {task.priority > 0 && (
          <span
            className={`prio prio-${task.priority}`}
            role="img"
            aria-label={`${PRIORITIES[task.priority]} priority`}
            title={`${PRIORITIES[task.priority]} priority`}
            data-testid={`task-priority-${task.id}`}
          />
        )}
      </span>
      <button
        type="button"
        className="btn-icon btn-danger task-delete"
        data-testid={`task-delete-${task.id}`}
        aria-label={`Delete task ${task.title}`}
        title="Delete"
        onClick={props.onDelete}
      >
        <Icon name="i-trash" />
      </button>
    </div>
  )
}

const PRIORITIES = ['None', 'Low', 'Medium', 'High'] as const
const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

/** Today as yyyy-MM-dd in the browser's time zone (due dates are plain dates). */
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type View = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed'

/** The ?view= filters; `today` is yyyy-MM-dd, so plain string comparison orders the dates. */
const VIEWS: Record<View, { label: string; test: (t: TaskItem, today: string) => boolean }> = {
  all: { label: 'All', test: (t) => !t.completed },
  today: { label: 'Today', test: (t, today) => t.dueDate === today },
  upcoming: { label: 'Upcoming', test: (t, today) => t.dueDate !== null && t.dueDate > today },
  overdue: { label: 'Overdue', test: (t, today) => !t.completed && t.dueDate !== null && t.dueDate < today },
  completed: { label: 'Completed', test: (t) => t.completed },
}
const VIEW_ORDER = Object.keys(VIEWS) as View[]

function parseView(value: string | null): View {
  return VIEW_ORDER.includes(value as View) ? (value as View) : 'all'
}

/** `needle` is already trimmed and lower-cased; tags are lower-case by contract. */
function matchesSearch(t: TaskItem, needle: string): boolean {
  if (!needle) return true
  return (
    t.title.toLowerCase().includes(needle) ||
    t.notes.toLowerCase().includes(needle) ||
    t.tags.some((tag) => tag.includes(needle))
  )
}

type Sort = 'manual' | 'due' | 'priority' | 'title' | 'created'

/** The ?sort= orders; the tasks arrive in manual order and Array.sort is stable, so ties keep it. */
const SORTS: Record<Sort, { label: string; compare: ((a: TaskItem, b: TaskItem) => number) | null }> = {
  manual: { label: 'Manual', compare: null },
  due: {
    label: 'Due date',
    compare: (a, b) =>
      a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1,
  },
  priority: { label: 'Priority', compare: (a, b) => b.priority - a.priority },
  title: { label: 'Title', compare: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) },
  created: { label: 'Created', compare: (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id },
}
const SORT_ORDER = Object.keys(SORTS) as Sort[]

function parseSort(value: string | null): Sort {
  return SORT_ORDER.includes(value as Sort) ? (value as Sort) : 'manual'
}

function sortTasks(tasks: TaskItem[], sort: Sort): TaskItem[] {
  const compare = SORTS[sort].compare
  return compare ? [...tasks].sort(compare) : tasks
}

function isOverdue(task: TaskItem): boolean {
  return !task.completed && task.dueDate !== null && task.dueDate < todayIso()
}

function formatDue(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const sameYear = y === new Date().getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

function TaskPanel(props: {
  task: TaskItem
  onChange: (changes: TaskChanges) => void
  onAddSubtask: (title: string) => void
  onToggleSubtask: (sub: Subtask) => void
  onDeleteSubtask: (sub: Subtask) => void
  onClose: () => void
}) {
  const { task, onChange, onClose } = props
  const [tagDraft, setTagDraft] = useState('')
  const [subtaskDraft, setSubtaskDraft] = useState('')

  // Escape closes the panel unless an inline editor already handled it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function saveTitle(value: string) {
    const title = value.trim()
    if (title && title !== task.title) onChange({ title })
  }

  function addTag() {
    const tag = tagDraft.trim().toLowerCase()
    setTagDraft('')
    if (tag && !task.tags.includes(tag)) onChange({ tags: [...task.tags, tag] })
  }

  function removeTag(tag: string) {
    onChange({ tags: task.tags.filter((t) => t !== tag) })
  }

  return (
    <aside className="panel" data-testid="task-panel" aria-label="Task details">
      <div className="panel-head">
        <input
          // Remounts with the saved title when it changes elsewhere (the row's inline editor).
          key={task.title}
          type="text"
          maxLength={200}
          defaultValue={task.title}
          aria-label="Title"
          data-testid="panel-title"
          onBlur={(e) => saveTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveTitle(e.currentTarget.value)
          }}
        />
        <button type="button" className="btn-icon" data-testid="panel-close" aria-label="Close details" onClick={onClose}>
          <Icon name="i-close" />
        </button>
      </div>

      <label htmlFor="panel-notes">Notes</label>
      <textarea
        key={task.notes}
        id="panel-notes"
        defaultValue={task.notes}
        data-testid="panel-notes"
        onBlur={(e) => {
          if (e.currentTarget.value !== task.notes) onChange({ notes: e.currentTarget.value })
        }}
      />

      <label htmlFor="panel-due">Due date</label>
      <input
        id="panel-due"
        type="date"
        value={task.dueDate ?? ''}
        data-testid="panel-due"
        onChange={(e) => onChange({ dueDate: e.currentTarget.value || null })}
      />

      <label htmlFor="panel-priority">Priority</label>
      <select
        id="panel-priority"
        value={task.priority}
        data-testid="panel-priority"
        onChange={(e) => onChange({ priority: Number(e.currentTarget.value) as TaskItem['priority'] })}
      >
        {PRIORITIES.map((label, value) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label htmlFor="panel-tags">Tags</label>
      <div className="tags-box">
        {task.tags.map((tag) => (
          <span key={tag} className="tag" data-testid={`panel-tag-${tag}`}>
            {tag}
            <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => removeTag(tag)}>
              ×
            </button>
          </span>
        ))}
        <input
          id="panel-tags"
          type="text"
          placeholder="Add a tag"
          value={tagDraft}
          data-testid="panel-tags-input"
          onChange={(e) => setTagDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            } else if (e.key === 'Backspace' && tagDraft === '' && task.tags.length > 0) {
              e.preventDefault()
              removeTag(task.tags[task.tags.length - 1])
            }
          }}
        />
      </div>

      <label htmlFor="panel-repeat">Repeat</label>
      <select
        id="panel-repeat"
        value={task.repeat}
        data-testid="panel-repeat"
        onChange={(e) => onChange({ repeat: e.currentTarget.value as Repeat })}
      >
        {REPEATS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      <label htmlFor="panel-subtask-add">Subtasks</label>
      <ul className="subtasks">
        {task.subtasks.map((s) => (
          <li key={s.id} className={`subtask-row${s.done ? ' done' : ''}`} data-testid={`subtask-row-${s.id}`}>
            <input
              type="checkbox"
              checked={s.done}
              data-testid={`subtask-check-${s.id}`}
              aria-label={`Done: ${s.title}`}
              onChange={() => props.onToggleSubtask(s)}
            />
            <span className="subtask-title">{s.title}</span>
            <button
              type="button"
              className="btn-icon btn-danger"
              data-testid={`subtask-delete-${s.id}`}
              aria-label={`Delete subtask ${s.title}`}
              title="Delete"
              onClick={() => props.onDeleteSubtask(s)}
            >
              <Icon name="i-trash" />
            </button>
          </li>
        ))}
      </ul>
      <input
        id="panel-subtask-add"
        type="text"
        className="subtask-add"
        maxLength={200}
        placeholder="Add a subtask"
        value={subtaskDraft}
        data-testid="subtask-add-input"
        onChange={(e) => setSubtaskDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const title = subtaskDraft.trim()
            setSubtaskDraft('')
            if (title) props.onAddSubtask(title)
          }
        }}
      />
    </aside>
  )
}
