import { useEffect, useState } from 'react';
import Header from './components/Header';
import TrackList from './components/TrackList';
import Sidebar, { type View } from './components/Sidebar';
import PlaylistView from './components/PlaylistView';
import LyricsEditor from './components/LyricsEditor';
import AdminPanel from './components/AdminPanel';
import UserFavoritesView from './components/UserFavoritesView';
import Login from './components/Login';
import ChangePasswordModal from './components/ChangePasswordModal';
import { PlayerProvider, usePlayer } from './player/PlayerContext';
import PlayerBar from './player/PlayerBar';
import NowPlayingView from './player/NowPlayingView';
import { AuthProvider, useAuth } from './AuthContext';
import { PrefsProvider } from './PrefsContext';
import { api } from './api';

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

/**
 * Decides which top-level UI to show based on auth state:
 *   - loading   → blank (avoid flashing the login form for already-signed-in users)
 *   - no user   → <Login />
 *   - user with must_change_password → main app + forced ChangePasswordModal
 *   - normal    → main app
 *
 * PlayerProvider lives INSIDE the gate so unauthenticated users don't
 * spin up an audio context that they have no way to use.
 */
function AuthGate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-zinc-500">
        加载中…
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <PrefsProvider>
      <PlayerProvider>
        <AppContent />
        {!!user.must_change_password && <ChangePasswordModal forced />}
      </PlayerProvider>
    </PrefsProvider>
  );
}

function AppContent() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  // Mobile drawer state — controlled by App so both Header (hamburger
  // button) and Sidebar (drawer self) can share it. On desktop the
  // sidebar stays static and these props are ignored.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const player = usePlayer();

  // Wrap setView so picking something in the mobile drawer auto-closes it.
  function handleSetView(v: View) {
    setView(v);
    setSidebarOpen(false);
  }

  // Deep-link handler: ?play=<rel_path> in the URL → look up the track,
  // start playback, and open the NowPlaying view. Then clean the URL so a
  // refresh doesn't replay it. Used when Chat hands the user a clickable
  // link that should land in our custom player instead of the browser's
  // bare audio element.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const playPath = params.get('play');
    if (!playPath) return;

    api
      .getTrackByPath(playPath)
      .then((track) => {
        player.playOne(track);
        setNowPlayingOpen(true);
      })
      .catch((err) => {
        // Track not found / lookup failed — silent (logged for debug)
        console.error('deep-link play failed:', err);
      })
      .finally(() => {
        // Clean the URL whether or not the track was found, so the user
        // can refresh without re-triggering.
        const url = new URL(window.location.href);
        url.searchParams.delete('play');
        window.history.replaceState({}, '', url.toString());
      });
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col">
      <Header
        onRescanned={refresh}
        onUploaded={refresh}
        onOpenSidebar={() => setSidebarOpen(true)}
      />
      <div className="flex-1 flex min-h-0 relative">
        <Sidebar
          view={view}
          setView={handleSetView}
          refreshKey={refreshKey}
          onChanged={refresh}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        {/* Mobile backdrop — renders only when drawer is open */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="md:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          />
        )}
        {view.kind === 'all' ? (
          <TrackList refreshKey={refreshKey} onChanged={refresh} />
        ) : view.kind === 'favorites' ? (
          <TrackList refreshKey={refreshKey} onChanged={refresh} favoritedOnly />
        ) : view.kind === 'lyrics-editor' ? (
          <LyricsEditor />
        ) : view.kind === 'admin' ? (
          <AdminPanel />
        ) : view.kind === 'user-favorites' ? (
          <UserFavoritesView
            userId={view.userId}
            ownerName={view.ownerName}
            refreshKey={refreshKey}
            onChanged={refresh}
          />
        ) : (
          <PlaylistView playlistId={view.id} refreshKey={refreshKey} onChanged={refresh} />
        )}
      </div>
      <PlayerBar
        onExpand={() => setNowPlayingOpen(true)}
        onLibraryChange={refresh}
      />
      <NowPlayingView
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        onLibraryChange={refresh}
      />
    </div>
  );
}
