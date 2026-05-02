import { useState } from 'react';
import Header from './components/Header';
import TrackList from './components/TrackList';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  return (
    <div className="h-full flex flex-col">
      <Header onRescanned={refresh} onUploaded={refresh} />
      <TrackList refreshKey={refreshKey} onChanged={refresh} />
    </div>
  );
}
