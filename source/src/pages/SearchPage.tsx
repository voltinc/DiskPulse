import { Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/common/Button';
import { FileList } from '../components/common/FileList';
import { Panel } from '../components/common/Panel';
import { ScanGate } from '../components/scanner/ScanGate';
import { useDebounced } from '../hooks/useDebounced';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import { formatNumber } from '../utils/format';

function Content() {
  const scanId = useApp((s) => s.scanId);
  const dataVersion = useApp((s) => s.dataVersion);
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 250);
  const [picked, setPicked] = useState<number[]>([]);
  const results = useLoad(
    () => (scanId && query ? api.search(scanId, query, undefined, 300) : Promise.resolve([])),
    [scanId, query, dataVersion],
  );
  useEffect(() => setPicked([]), [query, dataVersion]);
  const items = results.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="flex h-8 w-[420px] items-center gap-2 rounded border border-line bg-field px-2.5 focus-within:border-accent">
          <Search size={15} className="text-ink-3" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search file and folder names in this scan"
            aria-label="Search"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-ink-3"
          />
        </label>
        <span className="flex-1 text-[13px] text-ink-3">
          {query
            ? `${formatNumber(items.length)}${items.length >= 300 ? '+' : ''} matches, largest first`
            : ''}
        </span>
        <Button
          variant="danger"
          disabled={picked.length === 0}
          onClick={() => useApp.getState().requestTrash(picked)}
        >
          <Trash2 size={14} /> Move selected to Trash
        </Button>
      </div>
      {items.length > 0 ? (
        <FileList items={items} selection={picked} onSelection={setPicked} />
      ) : (
        <p className="py-10 text-center text-sm text-ink-3">
          {!query
            ? 'Type part of a name, for example "backup" or ".iso".'
            : results.loading
              ? 'Searching…'
              : `Nothing matches "${query}".`}
        </p>
      )}
    </div>
  );
}

export function SearchPage() {
  return (
    <Panel title="Search" subtitle="Case-insensitive match on names across the whole scan" className="h-full">
      <ScanGate>
        <Content />
      </ScanGate>
    </Panel>
  );
}
