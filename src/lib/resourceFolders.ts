import { supabase } from './supabase';

export interface ResourceFolder {
  id: string;
  name: string;
  scope: 'general' | 'brand';
  brand_id: string | null;
  parent_id: string | null;
  pinned: boolean;
  sort_order: number;
  created_at: string;
}

export interface Resource {
  id: string;
  name: string;
  url: string;
  description: string | null;
  scope: 'general' | 'brand';
  brand_id: string | null;
  general_folder: string | null;
  folder_id: string | null;
  pinned: boolean;
  sort_order: number;
  is_shared: boolean;
  created_at: string;
}

export type ExplorerScope =
  | { kind: 'general' }
  | { kind: 'brand'; brandId: string };

/** Compact path label of a folder by id, e.g. "Marketing / Q1 / Decks". */
export function folderPathLabel(
  folders: ResourceFolder[],
  folderId: string | null,
): string {
  if (!folderId) return '';
  const byId = new Map(folders.map(f => [f.id, f]));
  const parts: string[] = [];
  let cur = byId.get(folderId);
  let safety = 64;
  while (cur && safety-- > 0) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(' / ');
}

/** Breadcrumb trail from root to the given folder. */
export function folderTrail(
  folders: ResourceFolder[],
  folderId: string | null,
): ResourceFolder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map(f => [f.id, f]));
  const trail: ResourceFolder[] = [];
  let cur = byId.get(folderId);
  let safety = 64;
  while (cur && safety-- > 0) {
    trail.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return trail;
}

/** Set of folder ids that are descendants of `folderId` (inclusive). */
export function descendantIds(
  folders: ResourceFolder[],
  folderId: string,
): Set<string> {
  const out = new Set<string>([folderId]);
  // BFS down through parent_id pointers
  const byParent = new Map<string, ResourceFolder[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const arr = byParent.get(f.parent_id) ?? [];
    arr.push(f);
    byParent.set(f.parent_id, arr);
  }
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of byParent.get(id) ?? []) {
      if (!out.has(child.id)) { out.add(child.id); queue.push(child.id); }
    }
  }
  return out;
}

/** Load folders + resources for a scope (general or brand). */
export async function loadExplorer(scope: ExplorerScope) {
  const foldersQ = supabase.from('resource_folders').select('*');
  const resourcesQ = supabase.from('resources').select('*');
  if (scope.kind === 'brand') {
    foldersQ.eq('scope', 'brand').eq('brand_id', scope.brandId);
    resourcesQ.eq('scope', 'brand').eq('brand_id', scope.brandId);
  } else {
    foldersQ.eq('scope', 'general');
    resourcesQ.eq('scope', 'general');
  }
  const [{ data: f, error: fe }, { data: r, error: re }] = await Promise.all([
    foldersQ.order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    resourcesQ.order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
  ]);
  if (fe) throw fe;
  if (re) throw re;
  return {
    folders: ((f ?? []) as any[]).map(x => ({ ...x, pinned: !!x.pinned })) as ResourceFolder[],
    resources: ((r ?? []) as any[]).map(x => ({
      ...x,
      pinned: !!x.pinned,
      is_shared: !!x.is_shared,
    })) as Resource[],
  };
}

export async function createFolder(input: {
  name: string;
  scope: 'general' | 'brand';
  brandId?: string | null;
  parentId: string | null;
}): Promise<ResourceFolder> {
  const payload: any = {
    name: input.name.trim(),
    scope: input.scope,
    brand_id: input.scope === 'brand' ? (input.brandId ?? null) : null,
    parent_id: input.parentId,
  };
  const { data, error } = await supabase.from('resource_folders').insert(payload).select('*').single();
  if (error) throw error;
  return { ...(data as any), pinned: !!(data as any).pinned } as ResourceFolder;
}

export async function renameFolder(id: string, name: string) {
  const { error } = await supabase.from('resource_folders')
    .update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}

export async function deleteFolder(id: string) {
  // ON DELETE CASCADE removes child folders; resources inside have ON DELETE SET NULL
  // so they move back to root rather than disappear.
  const { error } = await supabase.from('resource_folders').delete().eq('id', id);
  if (error) throw error;
}

export async function setFolderParent(id: string, parentId: string | null) {
  const { error } = await supabase.from('resource_folders')
    .update({ parent_id: parentId }).eq('id', id);
  if (error) throw error;
}

export async function setFolderPinned(id: string, pinned: boolean) {
  const { error } = await supabase.from('resource_folders')
    .update({ pinned }).eq('id', id);
  if (error) throw error;
}

export async function setResourceFolder(resourceId: string, folderId: string | null) {
  const { error } = await supabase.from('resources')
    .update({ folder_id: folderId }).eq('id', resourceId);
  if (error) throw error;
}

export async function setResourcesFolderBulk(resourceIds: string[], folderId: string | null) {
  if (resourceIds.length === 0) return;
  const { error } = await supabase.from('resources')
    .update({ folder_id: folderId }).in('id', resourceIds);
  if (error) throw error;
}

export async function setResourcePinned(resourceId: string, pinned: boolean) {
  const { error } = await supabase.from('resources')
    .update({ pinned }).eq('id', resourceId);
  if (error) throw error;
}
