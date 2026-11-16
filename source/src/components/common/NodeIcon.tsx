import {
  Cog,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  Link2,
  Package,
} from 'lucide-react';
import type { NodeSummary } from '../../types';
import { categoryColor } from '../../utils/colors';

const FILE_ICONS = [FileVideo, FileImage, FileText, FileArchive, Package, FileAudio, FileCode, Cog, File];

export function NodeIcon({
  node,
  size = 15,
}: {
  node: Pick<NodeSummary, 'kind' | 'category' | 'is_symlink'>;
  size?: number;
}) {
  if (node.is_symlink) return <Link2 size={size} className="shrink-0 text-ink-3" />;
  if (node.kind === 'directory')
    return <Folder size={size} className="shrink-0" color="#e8b84a" fill="#e8b84a33" />;
  const Icon = FILE_ICONS[node.category] ?? File;
  return <Icon size={size} className="shrink-0" color={categoryColor(node.category)} />;
}
