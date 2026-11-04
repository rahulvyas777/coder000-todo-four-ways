import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router'
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
      <Sidebar lists={lists ?? []} />
      <Routes>
        <Route path="/" element={<Home lists={lists} error={error} />} />
        <Route path="/lists/:listId" element={<ListView lists={lists ?? []} />} />
        <Route path="/lists/:listId/tasks/:taskId" element={<ListView lists={lists ?? []} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function Sidebar({ lists }: { lists: TaskList[] }) {
  const { listId } = useParams()
  const activeId = Number(listId)
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
              <Link to={`/lists/${l.id}`} aria-current={l.id === activeId ? 'page' : undefined}>
                <span>{l.name}</span>
                <span className="list-count" data-testid={`list-count-${l.id}`} title="Open tasks">
                  {l.openCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
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

function ListView({ lists }: { lists: TaskList[] }) {
  const listId = Number(useParams().listId)
  const list = lists.find((l) => l.id === listId)
  const [loaded, setLoaded] = useState<{ listId: number; tasks: TaskItem[] } | null>(null)

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
      <div className="rows-container" data-testid="rows-container">
        {tasks?.map((t) => <TaskRow key={t.id} task={t} />)}
        {tasks?.length === 0 && <p className="empty-state">Nothing here</p>}
      </div>
    </main>
  )
}

function TaskRow({ task }: { task: TaskItem }) {
  return (
    <div className={`task-row${task.completed ? ' completed' : ''}`} data-testid={`task-row-${task.id}`}>
      <input
        type="checkbox"
        className="task-check"
        data-testid={`task-check-${task.id}`}
        checked={task.completed}
        readOnly
        aria-label={`Completed: ${task.title}`}
      />
      <span className="task-title" data-testid={`task-title-${task.id}`}>
        {task.title}
      </span>
    </div>
  )
}
