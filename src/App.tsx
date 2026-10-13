import { Route, Routes, useParams } from "react-router-dom";
import { useSongs } from "./hooks/useSongs";
import { SongbookSelectPage } from "./pages/SongbookSelectPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { SongDetailPage } from "./pages/SongDetailPage";
import { SongFormPage } from "./pages/SongFormPage";
import { SongModePage } from "./pages/SongModePage";
import { ConcertModePage } from "./pages/ConcertModePage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { PlaylistDetailPage } from "./pages/PlaylistDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BookDesignPage } from "./pages/BookDesignPage";
import { OverlayPage } from "./pages/OverlayPage";
import { QueueOverlayPage } from "./pages/QueueOverlayPage";
import { FeedbackHost } from "./components/ui/feedback";
import { OverlaySettingsPage } from "./pages/OverlaySettingsPage";
import { OverlayStudioPage } from "./pages/OverlayStudioPage";
import { SongRequestPage } from "./pages/SongRequestPage";
import { RequestQueuePage } from "./pages/RequestQueuePage";
import { RequireOwner } from "./components/RequireOwner";

/**
 * owner 노래책 하위 라우트들은 전부 같은 useSongs(ownerId) 결과를 공유해야
 * 추가/수정/삭제 직후 목록이 즉시 갱신된다. 그래서 이 래퍼가 한 번만
 * useSongs를 호출하고 하위 페이지에 songs/액션을 내려준다.
 */
function BookRoutes() {
  const { ownerId } = useParams();
  const {
    songs,
    loading,
    error,
    addSong,
    updateSong,
    removeSong,
    removeManySongs,
    removeAllSongs,
    reload,
  } = useSongs(ownerId);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <HomePage
            songs={songs}
            loading={loading}
            error={error}
            addSong={addSong}
            removeManySongs={removeManySongs}
            removeAllSongs={removeAllSongs}
            reload={reload}
          />
        }
      />
      <Route
        path="/songs/new"
        element={
          <RequireOwner>
            <SongFormPage songs={songs} onAdd={addSong} onUpdate={updateSong} />
          </RequireOwner>
        }
      />
      <Route
        path="/songs/:id/edit"
        element={
          <RequireOwner>
            <SongFormPage songs={songs} onAdd={addSong} onUpdate={updateSong} />
          </RequireOwner>
        }
      />
      <Route
        path="/songs/:id"
        element={<SongDetailPage songs={songs} onRemove={removeSong} onUpdate={updateSong} />}
      />
      <Route
        path="/songs/:id/sing"
        element={<SongModePage songs={songs} loading={loading} onUpdate={updateSong} />}
      />
      <Route path="/request" element={<SongRequestPage songs={songs} loading={loading} />} />
      <Route
        path="/requests"
        element={
          <RequireOwner>
            <RequestQueuePage />
          </RequireOwner>
        }
      />
      <Route path="/playlists" element={<PlaylistsPage />} />
      <Route path="/playlists/:playlistId" element={<PlaylistDetailPage />} />
      <Route
        path="/playlists/:playlistId/concert"
        element={<ConcertModePage songs={songs} loading={loading} />}
      />
      <Route
        path="/overlay-settings"
        element={
          <RequireOwner>
            <OverlaySettingsPage />
          </RequireOwner>
        }
      />
      <Route
        path="/overlay-studio"
        element={
          <RequireOwner>
            <OverlayStudioPage />
          </RequireOwner>
        }
      />
      <Route
        path="/design"
        element={
          <RequireOwner>
            <BookDesignPage />
          </RequireOwner>
        }
      />
    </Routes>
  );
}

/** 일반 앱 화면들 — 어두운 배경 래퍼를 쓴다. 방송 오버레이는 이 래퍼 밖에 있어야 배경이 투명해진다. */
function AppShell() {
  return (
    <div className="min-h-screen bg-[#14161F] text-[#F2F0EA]">
      <Routes>
        <Route path="/" element={<SongbookSelectPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/books/:ownerId/*" element={<BookRoutes />} />
      </Routes>
      <FeedbackHost />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/overlay" element={<OverlayPage />} />
      <Route path="/overlay/queue" element={<QueueOverlayPage />} />
      <Route path="/overlay/song" element={<OverlayPage kind="song" />} />
      <Route path="/overlay/lyrics" element={<OverlayPage kind="lyrics" />} />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}

export default App;
