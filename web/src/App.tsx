import { useState } from 'react';
import Header from './components/Header';
import TrackList from './components/TrackList';
import Sidebar, { type View } from './components/Sidebar';
import PlaylistView from './components/PlaylistView';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  const [view, setView] = useState<View>({ kind: 'all' });

  return (
    <div className="h-full flex flex-col">
      <Header onRescanned={refresh} onUploaded={refresh} />
      <div className="flex-1 flex min-h-0">
        <Sidebar view={view} setView={setView} refreshKey={refreshKey} onChanged={refresh} />
        {view.kind === 'all' ? (
          <TrackList refreshKey={refreshKey} onChanged={refresh} />
        ) : (
          <PlaylistView playlistId={view.id} refreshKey={refreshKey} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}
