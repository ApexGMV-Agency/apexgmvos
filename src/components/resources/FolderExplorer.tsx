import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Spinner, Alert, Button, Modal, Form, Dropdown, Badge } from 'react-bootstrap';
import {
  DndContext, DragOverlay, useSensor, useSensors, PointerSensor,
  useDraggable, useDroppable, DragEndEvent, DragStartEvent,
} from '@dnd-kit/core';
import {
  ResourceFolder, Resource, ExplorerScope, folderTrail, descendantIds, loadExplorer,
  createFolder, renameFolder, deleteFolder, setFolderParent, setFolderPinned,
  setResourceFolder, setResourcesFolderBulk, setResourcePinned,
} from '../../lib/resourceFolders';
import { resourceIcon } from '../../lib/resourceIcon';

interface Props {
  scope: ExplorerScope;
  canEdit: boolean;
  // Parent-controlled callbacks for add/edit/delete/comment.
  onAddResource?: (folderId: string | null) => void;
  onEditResource?: (r: Resource) => void;
  onDeleteResource?: (r: Resource) => Promise<void> | void;
  onCommentResource?: (r: Resource) => void;
  // Optional per-resource extras (share toggle, badges) — Bob's view uses this.
  renderResourceExtras?: (r: Resource) => ReactNode;
  // Bumped by the parent to force a reload after add/edit/delete in modals it owns.
  reloadKey?: number;
}

type DragKind = 'resource' | 'folder';
interface DragItem { kind: DragKind; id: string; name: string; count?: number }

export default function FolderExplorer({
  scope, canEdit, onAddResource, onEditResource, onDeleteResource, onCommentResource,
  renderResourceExtras, reloadKey,
}: Props) {
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null); // current folder id, null = root
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create-folder modal
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);

  // Rename modal
  const [renaming, setRenaming] = useState<ResourceFolder | null>(null);
  const [renameTo, setRenameTo] = useState('');

  // Drag state
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reload = async () => {
    setLoading(true); setErr(null);
    try {
      const { folders, resources } = await loadExplorer(scope);
      setFolders(folders);
      setResources(resources);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [scope.kind, (scope as any).brandId, reloadKey]);

  // Reset selection when navigating folders.
  useEffect(() => { setSelected(new Set()); }, [cwd]);

  const trail = useMemo(() => folderTrail(folders, cwd), [folders, cwd]);

  // Items in current folder (or matching search across all if searching).
  const { foldersHere, resourcesHere, isSearching } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const ff = folders.filter(f => f.name.toLowerCase().includes(q));
      const rr = resources.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q));
      return { foldersHere: ff, resourcesHere: rr, isSearching: true };
    }
    const ff = folders.filter(f => f.parent_id === cwd);
    const rr = resources.filter(r => (r.folder_id ?? null) === cwd);
    return { foldersHere: ff, resourcesHere: rr, isSearching: false };
  }, [folders, resources, cwd, search]);

  // Pinned sections (only when not searching).
  const pinnedFolders = isSearching ? [] : foldersHere.filter(f => f.pinned);
  const otherFolders  = isSearching ? foldersHere : foldersHere.filter(f => !f.pinned);
  const pinnedResources = isSearching ? [] : resourcesHere.filter(r => r.pinned);
  const otherResources  = isSearching ? resourcesHere : resourcesHere.filter(r => !r.pinned);

  // --- Actions ---
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true); setErr(null);
    try {
      await createFolder({
        name: newFolderName,
        scope: scope.kind === 'brand' ? 'brand' : 'general',
        brandId: scope.kind === 'brand' ? scope.brandId : null,
        parentId: cwd,
      });
      setShowCreate(false);
      setNewFolderName('');
      await reload();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create folder');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renaming || !renameTo.trim()) return;
    setBusy(true);
    try {
      await renameFolder(renaming.id, renameTo);
      setRenaming(null); setRenameTo('');
      await reload();
    } catch (e: any) {
      alert(e?.message ?? 'Rename failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteFolder = async (f: ResourceFolder) => {
    if (!confirm(`Delete folder "${f.name}" and any subfolders? Resources inside will move to the parent folder.`)) return;
    try {
      await deleteFolder(f.id);
      await reload();
    } catch (e: any) {
      alert(e?.message ?? 'Delete failed');
    }
  };

  const handleTogglePinFolder = async (f: ResourceFolder) => {
    setFolders(prev => prev.map(x => x.id === f.id ? { ...x, pinned: !f.pinned } : x));
    try { await setFolderPinned(f.id, !f.pinned); }
    catch (e: any) { alert(e?.message ?? 'Failed'); reload(); }
  };

  const handleTogglePinResource = async (r: Resource) => {
    setResources(prev => prev.map(x => x.id === r.id ? { ...x, pinned: !r.pinned } : x));
    try { await setResourcePinned(r.id, !r.pinned); }
    catch (e: any) { alert(e?.message ?? 'Failed'); reload(); }
  };

  const moveResources = async (resourceIds: string[], targetFolderId: string | null) => {
    if (resourceIds.length === 0) return;
    // optimistic
    setResources(prev => prev.map(r =>
      resourceIds.includes(r.id) ? { ...r, folder_id: targetFolderId } : r));
    try {
      await setResourcesFolderBulk(resourceIds, targetFolderId);
    } catch (e: any) {
      alert(e?.message ?? 'Move failed'); reload();
    }
  };

  const moveFolder = async (folderId: string, targetFolderId: string | null) => {
    // Prevent moving into self / a descendant
    const desc = descendantIds(folders, folderId);
    if (targetFolderId && desc.has(targetFolderId)) {
      alert("Can't move a folder into itself or one of its subfolders.");
      return;
    }
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, parent_id: targetFolderId } : f));
    try { await setFolderParent(folderId, targetFolderId); }
    catch (e: any) { alert(e?.message ?? 'Move failed'); reload(); }
  };

  // --- Selection helpers ---
  const toggleSelectResource = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const selectAllVisible = () => setSelected(new Set(resourcesHere.map(r => r.id)));

  // --- Drag/drop ---
  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragItem | undefined;
    if (!data) return;
    setDragging(data);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const data = e.active.data.current as DragItem | undefined;
    const over = e.over?.id as string | undefined;
    if (!data || over === undefined) return;
    // over is "folder:<id>" or "root"
    const targetFolderId = over === 'root' ? null : over.startsWith('folder:') ? over.slice('folder:'.length) : undefined;
    if (targetFolderId === undefined) return;

    if (data.kind === 'resource') {
      // If the dragged resource is part of a multi-selection, move all.
      const ids = selected.has(data.id) && selected.size > 0 ? Array.from(selected) : [data.id];
      moveResources(ids, targetFolderId);
      if (selected.size > 0) clearSelection();
    } else {
      moveFolder(data.id, targetFolderId);
    }
  };

  // ----- Render -----
  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const goRoot = () => { setCwd(null); setSearch(''); };
  const goTo = (id: string | null) => { setCwd(id); setSearch(''); };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* Toolbar */}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {/* Breadcrumb trail */}
        <nav aria-label="folder breadcrumb" className="d-flex align-items-center flex-wrap gap-1">
          <RootDrop onDropToRoot={() => {}} active={cwd === null}>
            <button type="button" className="btn btn-sm btn-link text-decoration-none px-2"
              onClick={goRoot}>
              <i className="bi bi-house-door me-1" />Root
            </button>
          </RootDrop>
          {trail.map(f => (
            <span key={f.id} className="d-flex align-items-center">
              <i className="bi bi-chevron-right text-muted small" />
              <button type="button" className="btn btn-sm btn-link text-decoration-none px-2"
                onClick={() => goTo(f.id)}>
                <i className="bi bi-folder me-1" />{f.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="ms-auto d-flex gap-2 flex-wrap">
          <div className="input-group input-group-sm" style={{ minWidth: 240 }}>
            <span className="input-group-text"><i className="bi bi-search" /></span>
            <input className="form-control" placeholder="Search folders & resources…"
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button type="button" className="btn btn-outline-secondary" onClick={() => setSearch('')}>
                <i className="bi bi-x-lg" />
              </button>
            )}
          </div>
          {canEdit && (
            <>
              <Button size="sm" variant="outline-secondary" onClick={() => setShowCreate(true)}>
                <i className="bi bi-folder-plus me-1" />New folder
              </Button>
              {onAddResource && (
                <Button size="sm" onClick={() => onAddResource(cwd)}>
                  <i className="bi bi-plus-lg me-1" />Add resource
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Multi-select toolbar (sticky banner) */}
      {selected.size > 0 && (
        <div className="d-flex align-items-center gap-2 p-2 mb-2 rounded"
          style={{ background: 'rgba(232,134,46,.08)', border: '1px solid rgba(232,134,46,.35)' }}>
          <strong className="me-2">
            <i className="bi bi-check2-square me-1" />{selected.size} selected
          </strong>
          <MoveToMenu
            folders={folders}
            label="Move to…"
            disabledIds={new Set()}
            currentId={cwd}
            onPick={async (target) => { await moveResources(Array.from(selected), target); clearSelection(); }}
          />
          <Button size="sm" variant="link" className="text-decoration-none" onClick={selectAllVisible}>
            Select all
          </Button>
          <Button size="sm" variant="link" className="text-decoration-none text-muted ms-auto" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {/* Empty state */}
      {foldersHere.length === 0 && resourcesHere.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-folder2-open fs-1 d-block mb-2 opacity-50" />
          {isSearching ? 'Nothing matches your search.' : 'Empty folder. Use "New folder" or "Add resource" to fill it.'}
        </div>
      ) : (
        <>
          {/* Pinned folders */}
          {pinnedFolders.length > 0 && (
            <SectionLabel icon="bi-pin-angle-fill" label="Pinned folders" />
          )}
          <div className="row g-3 mb-3">
            {pinnedFolders.map(f => (
              <FolderCard key={f.id} folder={f} count={countInside(folders, resources, f.id)}
                canEdit={canEdit} pinned
                onOpen={() => goTo(f.id)}
                onRename={() => { setRenaming(f); setRenameTo(f.name); }}
                onDelete={() => handleDeleteFolder(f)}
                onTogglePin={() => handleTogglePinFolder(f)}
                onMoveTo={() => {}} // handled by dropdown inside card
                folders={folders} currentId={cwd}
                onMovePick={(target) => moveFolder(f.id, target)}
              />
            ))}
          </div>

          {/* Pinned resources */}
          {pinnedResources.length > 0 && (
            <SectionLabel icon="bi-pin-angle-fill" label="Pinned resources" />
          )}
          <div className="row g-3 mb-3">
            {pinnedResources.map(r => (
              <ResourceCard key={r.id} resource={r}
                canEdit={canEdit} pinned
                selected={selected.has(r.id)}
                onToggleSelect={(e) => toggleSelectResource(r.id, e)}
                onEdit={onEditResource}
                onDelete={onDeleteResource}
                onComment={onCommentResource}
                onTogglePin={() => handleTogglePinResource(r)}
                extras={renderResourceExtras?.(r)}
                folders={folders}
                onMovePick={(target) => moveResources([r.id], target)}
              />
            ))}
          </div>

          {(pinnedFolders.length > 0 || pinnedResources.length > 0) && (otherFolders.length > 0 || otherResources.length > 0) && (
            <SectionLabel icon="bi-folder2" label={isSearching ? 'Results' : 'All items'} />
          )}

          {/* Folders */}
          <div className="row g-3 mb-3">
            {otherFolders.map(f => (
              <FolderCard key={f.id} folder={f} count={countInside(folders, resources, f.id)}
                canEdit={canEdit}
                onOpen={() => goTo(f.id)}
                onRename={() => { setRenaming(f); setRenameTo(f.name); }}
                onDelete={() => handleDeleteFolder(f)}
                onTogglePin={() => handleTogglePinFolder(f)}
                onMoveTo={() => {}}
                folders={folders} currentId={cwd}
                onMovePick={(target) => moveFolder(f.id, target)}
              />
            ))}
          </div>

          {/* Resources */}
          <div className="row g-3">
            {otherResources.map(r => (
              <ResourceCard key={r.id} resource={r}
                canEdit={canEdit}
                selected={selected.has(r.id)}
                onToggleSelect={(e) => toggleSelectResource(r.id, e)}
                onEdit={onEditResource}
                onDelete={onDeleteResource}
                onComment={onCommentResource}
                onTogglePin={() => handleTogglePinResource(r)}
                extras={renderResourceExtras?.(r)}
                folders={folders}
                onMovePick={(target) => moveResources([r.id], target)}
              />
            ))}
          </div>
        </>
      )}

      {/* Create folder modal */}
      <Modal show={showCreate} onHide={() => setShowCreate(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-folder-plus me-2" />New folder</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={e => { e.preventDefault(); handleCreateFolder(); }}>
            <Form.Label className="fw-bold">Folder name</Form.Label>
            <Form.Control autoFocus value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. Brand Guidelines" />
            {cwd && (
              <Form.Text className="text-muted">
                Will be created inside <strong>{folders.find(f => f.id === cwd)?.name ?? 'this folder'}</strong>.
              </Form.Text>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleCreateFolder} disabled={busy || !newFolderName.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Rename modal */}
      <Modal show={!!renaming} onHide={() => setRenaming(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-pencil me-2" />Rename folder</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={e => { e.preventDefault(); handleRename(); }}>
            <Form.Label className="fw-bold">New name</Form.Label>
            <Form.Control autoFocus value={renameTo}
              onChange={e => setRenameTo(e.target.value)} />
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRenaming(null)} disabled={busy}>Cancel</Button>
          <Button onClick={handleRename} disabled={busy || !renameTo.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Drag preview */}
      <DragOverlay>
        {dragging && (
          <div className="px-3 py-2 bg-white rounded shadow"
            style={{ border: '2px solid #e8862e', maxWidth: 260 }}>
            <i className={`bi ${dragging.kind === 'folder' ? 'bi-folder-fill' : 'bi-file-earmark'} me-2 text-primary`} />
            <strong>{dragging.name}</strong>
            {dragging.kind === 'resource' && selected.size > 1 && selected.has(dragging.id) && (
              <Badge bg="primary" className="ms-2">+{selected.size - 1}</Badge>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ===========================================================================
// Folder card — draggable + droppable
// ===========================================================================
function FolderCard({
  folder, count, canEdit, pinned, onOpen, onRename, onDelete, onTogglePin,
  folders, currentId, onMovePick,
}: {
  folder: ResourceFolder; count: number;
  canEdit: boolean; pinned?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onMoveTo: () => void;
  folders: ResourceFolder[];
  currentId: string | null;
  onMovePick: (target: string | null) => void;
}) {
  // Draggable handle
  const drag = useDraggable({
    id: `folder:${folder.id}`,
    data: { kind: 'folder', id: folder.id, name: folder.name } as DragItem,
    disabled: !canEdit,
  });
  // Droppable target (can drop other folders/resources into this one)
  const drop = useDroppable({ id: `folder:${folder.id}` });

  // Disallow dropping a folder into its own descendants
  const disabledIds = useMemo(() => descendantIds(folders, folder.id), [folders, folder.id]);

  return (
    <div className="col-md-6 col-lg-4 col-xl-3" ref={drop.setNodeRef}>
      <div
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        className="card h-100 shadow-sm folder-explorer-card"
        style={{
          cursor: canEdit ? 'grab' : 'pointer',
          opacity: drag.isDragging ? .4 : 1,
          borderColor: drop.isOver ? '#e8862e' : undefined,
          boxShadow: drop.isOver ? '0 0 0 2px #e8862e' : undefined,
          background: drop.isOver ? 'rgba(232,134,46,.05)' : undefined,
          transition: 'transform .12s, box-shadow .12s',
        }}
      >
        <div className="card-body d-flex align-items-center gap-3" onClick={onOpen} role="button">
          <div style={{
            width: 48, height: 40, borderRadius: 8,
            background: '#fff7ed', color: '#e8862e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontSize: '1.4rem',
            border: '1px solid rgba(232,134,46,.25)',
          }}>
            <i className={`bi ${pinned ? 'bi-folder-fill' : 'bi-folder2'}`} />
          </div>
          <div className="flex-grow-1 min-w-0">
            <div className="d-flex align-items-center gap-1 min-w-0">
              <span className="fw-semibold text-truncate">{folder.name}</span>
              {folder.pinned && <i className="bi bi-pin-angle-fill text-warning" title="Pinned" />}
            </div>
            <div className="text-muted small">{count} item{count === 1 ? '' : 's'}</div>
          </div>
          {canEdit && (
            <Dropdown align="end" onClick={(e) => e.stopPropagation()}>
              <Dropdown.Toggle as="button" className="btn btn-sm btn-link text-muted p-0" id={`fmenu-${folder.id}`}>
                <i className="bi bi-three-dots-vertical" />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item onClick={onTogglePin}>
                  <i className={`bi ${folder.pinned ? 'bi-pin-angle' : 'bi-pin-angle-fill'} me-2`} />
                  {folder.pinned ? 'Unpin' : 'Pin'}
                </Dropdown.Item>
                <Dropdown.Item onClick={onRename}>
                  <i className="bi bi-pencil me-2" />Rename
                </Dropdown.Item>
                <MoveToDropdownItems folders={folders} currentId={currentId} disabledIds={disabledIds} onPick={onMovePick} />
                <Dropdown.Divider />
                <Dropdown.Item className="text-danger" onClick={onDelete}>
                  <i className="bi bi-trash me-2" />Delete
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Resource card — draggable, selectable, with menu
// ===========================================================================
function ResourceCard({
  resource, canEdit, pinned, selected, onToggleSelect,
  onEdit, onDelete, onComment, onTogglePin, extras, folders, onMovePick,
}: {
  resource: Resource; canEdit: boolean; pinned?: boolean;
  selected: boolean;
  onToggleSelect: (e?: React.MouseEvent) => void;
  onEdit?: (r: Resource) => void;
  onDelete?: (r: Resource) => Promise<void> | void;
  onComment?: (r: Resource) => void;
  onTogglePin: () => void;
  extras?: ReactNode;
  folders: ResourceFolder[];
  onMovePick: (target: string | null) => void;
}) {
  const ic = resourceIcon(resource.url);
  const drag = useDraggable({
    id: `resource:${resource.id}`,
    data: { kind: 'resource', id: resource.id, name: resource.name } as DragItem,
    disabled: !canEdit,
  });
  return (
    <div className="col-md-6 col-lg-4">
      <div
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        className="card h-100 shadow-sm"
        style={{
          cursor: canEdit ? 'grab' : 'default',
          opacity: drag.isDragging ? .4 : 1,
          borderLeft: `4px solid ${ic.color}`,
          outline: selected ? '2px solid #e8862e' : undefined,
          outlineOffset: '-2px',
          background: selected ? 'rgba(232,134,46,.04)' : undefined,
        }}
      >
        <div className="card-body">
          <div className="d-flex align-items-start justify-content-between mb-2">
            <div className="d-flex align-items-center gap-2">
              {canEdit && (
                <Form.Check
                  type="checkbox"
                  checked={selected}
                  onChange={() => {}}
                  onClick={(e) => onToggleSelect(e)}
                  title="Select"
                  className="m-0"
                />
              )}
              <div style={{ fontSize: '1.8rem', color: ic.color, lineHeight: 1 }}>
                <i className={`bi ${ic.icon}`} />
              </div>
            </div>
            <div className="d-flex align-items-center gap-1">
              {resource.pinned && <i className="bi bi-pin-angle-fill text-warning" title="Pinned" />}
              {canEdit && (
                <Dropdown align="end">
                  <Dropdown.Toggle as="button" className="btn btn-sm btn-link text-muted p-0" id={`rmenu-${resource.id}`}>
                    <i className="bi bi-three-dots-vertical" />
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item onClick={onTogglePin}>
                      <i className={`bi ${resource.pinned ? 'bi-pin-angle' : 'bi-pin-angle-fill'} me-2`} />
                      {resource.pinned ? 'Unpin' : 'Pin'}
                    </Dropdown.Item>
                    <MoveToDropdownItems folders={folders} currentId={resource.folder_id ?? null} disabledIds={new Set()} onPick={onMovePick} />
                    <Dropdown.Divider />
                    {onEdit && <Dropdown.Item onClick={() => onEdit(resource)}><i className="bi bi-pencil me-2" />Edit</Dropdown.Item>}
                    {onDelete && <Dropdown.Item className="text-danger" onClick={() => onDelete(resource)}><i className="bi bi-trash me-2" />Delete</Dropdown.Item>}
                  </Dropdown.Menu>
                </Dropdown>
              )}
            </div>
          </div>

          <h6 className="mb-1 text-truncate" title={resource.name}>{resource.name}</h6>
          <div className="text-muted small text-truncate mb-2">
            <i className="bi bi-link-45deg" /> {ic.label}
          </div>
          {resource.description && (
            <p className="small text-muted mb-2" style={{ whiteSpace: 'pre-wrap' }}>{resource.description}</p>
          )}

          {extras}

          <div className="d-flex justify-content-between align-items-center mt-3 gap-2">
            <a href={resource.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
              Open <i className="bi bi-box-arrow-up-right ms-1" />
            </a>
            {onComment && (
              <Button size="sm" variant="outline-info" onClick={() => onComment(resource)}>
                <i className="bi bi-chat-left-text" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Move-to helpers
// ===========================================================================
function MoveToMenu({
  folders, label, disabledIds, currentId, onPick,
}: {
  folders: ResourceFolder[];
  label: string;
  disabledIds: Set<string>;
  currentId: string | null;
  onPick: (target: string | null) => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Toggle size="sm" variant="outline-primary"><i className="bi bi-arrows-move me-1" />{label}</Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 320, overflowY: 'auto', minWidth: 240 }}>
        <Dropdown.Item disabled={currentId === null} onClick={() => onPick(null)}>
          <i className="bi bi-house-door me-2" />Root
        </Dropdown.Item>
        <Dropdown.Divider />
        {folders.length === 0 && (
          <Dropdown.ItemText className="text-muted small">No folders yet.</Dropdown.ItemText>
        )}
        {folders.map(f => (
          <Dropdown.Item key={f.id}
            disabled={disabledIds.has(f.id) || currentId === f.id}
            onClick={() => onPick(f.id)}>
            <i className="bi bi-folder me-2" />{folderPath(folders, f.id)}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

function MoveToDropdownItems({
  folders, currentId, disabledIds, onPick,
}: {
  folders: ResourceFolder[];
  currentId: string | null;
  disabledIds: Set<string>;
  onPick: (target: string | null) => void;
}) {
  return (
    <>
      <Dropdown.Header>Move to…</Dropdown.Header>
      <Dropdown.Item disabled={currentId === null} onClick={() => onPick(null)}>
        <i className="bi bi-house-door me-2" />Root
      </Dropdown.Item>
      {folders.slice(0, 200).map(f => (
        <Dropdown.Item key={f.id}
          disabled={disabledIds.has(f.id) || currentId === f.id}
          onClick={() => onPick(f.id)}>
          <i className="bi bi-folder me-2" />{folderPath(folders, f.id)}
        </Dropdown.Item>
      ))}
    </>
  );
}

function folderPath(folders: ResourceFolder[], id: string): string {
  const byId = new Map(folders.map(f => [f.id, f]));
  const out: string[] = [];
  let cur = byId.get(id);
  let safety = 64;
  while (cur && safety-- > 0) {
    out.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out.join(' / ');
}

function countInside(
  folders: ResourceFolder[],
  resources: Resource[],
  folderId: string,
): number {
  const ids = descendantIds(folders, folderId);
  return resources.filter(r => r.folder_id && ids.has(r.folder_id)).length;
}

function SectionLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <h6 className="text-muted text-uppercase small fw-bold mt-2 mb-2" style={{ letterSpacing: '.5px' }}>
      <i className={`bi ${icon} me-1`} />{label}
    </h6>
  );
}

function RootDrop({
  active, children,
}: { active: boolean; onDropToRoot: () => void; children: ReactNode }) {
  const drop = useDroppable({ id: 'root' });
  return (
    <span ref={drop.setNodeRef}
      style={{
        background: drop.isOver ? 'rgba(232,134,46,.1)' : undefined,
        borderRadius: 6,
        outline: drop.isOver ? '1px dashed #e8862e' : undefined,
      }}>
      {children}
      {active && drop.isOver && <i className="bi bi-arrow-down-circle text-warning ms-1" />}
    </span>
  );
}
