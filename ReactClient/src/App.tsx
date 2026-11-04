import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, Navigate, Route, Routes, useMatch, useNavigate, useParams } from 'react-router'
import { api, type TaskItem, type TaskList } from './api'

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
        <Route path="/lists/:listId" element={<ListView lists={lists ?? []} setLists={setLists} />} />
        <Route path="/lists/:listId/tasks/:taskId" element={<ListView lists={lists ?? []} setLists={setLists} />} />
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
        else if (e.key === 'Escape') finish(null)
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

  return (
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
            onToggle={() => void toggleTask(t)}
            onRename={(title) => void renameTask(t, title)}
            onDelete={() => void deleteTask(t)}
          />
        ))}
        {tasks?.length === 0 && <p className="empty-state">Nothing here</p>}
      </div>
    </main>
  )
}

function TaskRow(props: {
  task: TaskItem
  onToggle: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const { task } = props
  const [editing, setEditing] = useState(false)

  return (
    <div className={`task-row${task.completed ? ' completed' : ''}`} data-testid={`task-row-${task.id}`}>
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
