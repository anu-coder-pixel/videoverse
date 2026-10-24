import { AppProvider, useApp } from './context/AppContext';
import Navbar from './components/Navbar/Navbar';
import Sidebar from './components/Sidebar/Sidebar';
import AuthModal from './components/AuthModal/AuthModal';
import HomePage from './pages/HomePage/HomePage';
import WatchPage from './pages/WatchPage/WatchPage';
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
      </div>

      {/* Authentication Modal */}
      <AuthModal />

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
      <AppInner />
    </AppProvider>
  );
}
