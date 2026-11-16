export function fileManagerName(os: string | undefined): string {
  if (os === 'windows') return 'File Explorer';
  if (os === 'macos') return 'Finder';
  return 'file manager';
}

export function trashName(os: string | undefined): string {
  return os === 'windows' ? 'Recycle Bin' : 'Trash';
}
