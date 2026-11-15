import { AppProvider, useApp } from './context/AppContext';
import { CallProvider } from './context/CallContext';
import Navbar from './components/Navbar/Navbar';
import Sidebar from './components/Sidebar/Sidebar';
import AuthModal from './components/AuthModal/AuthModal';
import IncomingCallModal from './components/IncomingCallModal/IncomingCallModal';
import UploadModal from './components/UploadModal/UploadModal';
import HomePage from './pages/HomePage/HomePage';
import WatchPage from './pages/WatchPage/WatchPage';
import CallPage from './pages/CallPage/CallPage';
import './App.css';

function AppInner() {
  const { currentPage, sidebarOpen, sidebarCollapsed, appToast } = useApp();

  return (
    <div className="app">
      <Navbar />
      <Sidebar />
      <div
        className={`app__content ${
          sidebarOpen
            ? sidebarCollapsed
              ? 'app__content--sidebar-collapsed'
              : 'app__content--sidebar-open'
            : ''
        }`}
      >
        {currentPage === 'home' && <HomePage />}
        {currentPage === 'watch' && <WatchPage />}
        {currentPage === 'call' && <CallPage />}
      </div>

      {/* Authentication Modal */}
      <AuthModal />

      {/* Creator Video Upload Modal (Phase 5 Module 4) */}
      <UploadModal />

      {/* Global Incoming Call Invitation Modal */}
      <IncomingCallModal />

      {appToast && (
        <div className="app__toast animate-fade-in" role="status" aria-live="polite">
          {appToast}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <CallProvider>
        <AppInner />
      </CallProvider>
    </AppProvider>
  );
}
