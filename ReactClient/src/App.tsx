import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useMatch, useNavigate, useParams } from 'react-router'
import { api, type Repeat, type TaskChanges, type TaskItem, type TaskList } from './api'

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

  return (
    <div className="app">
      <Sidebar lists={lists ?? []} setLists={setLists} />
      <Routes>
        <Route path="/" element={<Home lists={lists} error={error} />} />
        {/* One route for the list and its panel, so opening the panel never remounts the list. */}
        <Route path="/lists/:listId/*" element={<ListView lists={lists ?? []} setLists={setLists} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`/icons.svg#${name}`} />
    </svg>
  )
}

type SetLists = Dispatch<SetStateAction<TaskList[] | null>>

function Sidebar({ lists, setLists }: { lists: TaskList[]; setLists: SetLists }) {
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
    if (list.id === activeId) navigate('/', { replace: true })
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

function ListView({ lists, setLists }: { lists: TaskList[]; setLists: SetLists }) {
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

  async function toggleTask(task: TaskItem) {
    const updated = task.completed ? await api.reopenTask(task.id) : (await api.completeTask(task.id)).task
    replaceTask(updated)
    if (updated.completed !== task.completed) adjustCounts(0, updated.completed ? -1 : 1)
  }

  async function renameTask(task: TaskItem, title: string) {
    replaceTask(await api.updateTask(task.id, { title }))
  }

  /** Shows the change at once, then the server's version of the task. */
  async function editTask(task: TaskItem, changes: TaskChanges) {
    replaceTask({ ...task, ...changes })
    replaceTask(await api.updateTask(task.id, changes))
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
  }, [listId])

  // Rows of a previous list are never shown while the next one loads.
  const tasks = loaded?.listId === listId ? loaded.tasks : null
  const open = tasks?.filter((t) => !t.completed).length ?? 0
  const openTaskItem = tasks?.find((t) => t.id === openId)

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
          disabled={!tasks}
        />
      </form>
      <div className="rows-container" data-testid="rows-container">
        {tasks?.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            isOpen={t.id === openId}
            onOpen={() => openTask(t.id)}
            onToggle={() => void toggleTask(t)}
            onRename={(title) => void renameTask(t, title)}
            onDelete={() => void deleteTask(t)}
          />
        ))}
        {tasks?.length === 0 && <p className="empty-state">Nothing here</p>}
      </div>
    </main>
    {openTaskItem && (
      <TaskPanel
        key={openTaskItem.id}
        task={openTaskItem}
        onChange={(changes) => void editTask(openTaskItem, changes)}
        onClose={closePanel}
      />
    )}
    </>
  )
}

function TaskRow(props: {
  task: TaskItem
  isOpen: boolean
  onOpen: () => void
  onToggle: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const { task } = props
  const [editing, setEditing] = useState(false)

  return (
    <div
      className={`task-row${task.completed ? ' completed' : ''}${isOverdue(task) ? ' overdue' : ''}${props.isOpen ? ' open' : ''}`}
      data-testid={`task-row-${task.id}`}
      onClick={(e) => {
        // Clicks on the row's own controls (checkbox, delete, title editor) do not open the panel.
        if (!(e.target as HTMLElement).closest('input, button, select, textarea')) props.onOpen()
      }}
    >
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

function isOverdue(task: TaskItem): boolean {
  return !task.completed && task.dueDate !== null && task.dueDate < todayIso()
}

function formatDue(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const sameYear = y === new Date().getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

function TaskPanel(props: { task: TaskItem; onChange: (changes: TaskChanges) => void; onClose: () => void }) {
  const { task, onChange, onClose } = props
  const [tagDraft, setTagDraft] = useState('')

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
    </aside>
  )
}
