// Drag-and-drop reorder with native HTML5 drag events (no library). The drag-handle is the
// draggable element; a drop on a task row reports (dragged id, target id, before|after) to the
// page's .NET object, which reorders the list and sends POST /api/tasks/reorder.
//
// The drop-before / drop-after / dragging classes are set here directly: they only live for
// the duration of a drag, so a server render never needs to know about them.
window.taskReorder = (() => {
  let page = null;
  let draggedId = null;
  let marked = null;

  const rowOf = (el) => el?.closest?.('[data-testid^="task-row-"]');
  const idOf = (row) => Number(/^task-row-(\d+)$/.exec(row.getAttribute('data-testid'))?.[1]);
  const isAfter = (row, e) => {
    const r = row.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  function clearMark() {
    marked?.classList.remove('drop-before', 'drop-after');
    marked = null;
  }

  function end() {
    clearMark();
    document.querySelector('.task-row.dragging')?.classList.remove('dragging');
    draggedId = null;
  }

  document.addEventListener('dragstart', (e) => {
    const handle = e.target.closest?.('[data-testid^="drag-handle-"]');
    const row = rowOf(handle);
    if (!row) return;
    draggedId = idOf(row);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(draggedId));
    e.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2);
    row.classList.add('dragging');
  });

  document.addEventListener('dragover', (e) => {
    if (draggedId === null) return;
    const row = rowOf(e.target);
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (marked !== row) clearMark();
    marked = row;
    const after = isAfter(row, e);
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });

  document.addEventListener('drop', (e) => {
    if (draggedId === null) return;
    const row = rowOf(e.target);
    if (!row) return;
    e.preventDefault();
    const from = draggedId;
    const to = idOf(row);
    const after = isAfter(row, e);
    end();
    if (from !== to) page?.invokeMethodAsync('MoveTask', from, to, after);
  });

  document.addEventListener('dragend', end);

  return {
    register: (ref) => { page = ref; },
    unregister: (ref) => { if (page === ref) page = null; },
  };
})();
