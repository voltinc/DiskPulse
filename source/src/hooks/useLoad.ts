import { useEffect, useState } from 'react';
import { errorText } from '../utils/format';

export interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Run an async loader whenever `deps` change; stale responses are ignored. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => live && setState({ data, loading: false, error: null }))
      .catch((e) => live && setState((s) => ({ ...s, loading: false, error: errorText(e) })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
