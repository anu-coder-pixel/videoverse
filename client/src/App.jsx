import { AppProvider, useApp } from './context/AppContext';
import Navbar from './components/Navbar/Navbar';
import Sidebar from './components/Sidebar/Sidebar';
import HomePage from './pages/HomePage/HomePage';
import WatchPage from './pages/WatchPage/WatchPage';
import './App.css';

/**
 * VideoVerse — Root Application
 *
 * Day 1 status:
 * ✅ Responsive homepage with video grid
 * ✅ Sidebar navigation with collapse
 * ✅ Top navbar with search
 * ✅ Category pill filters
 * ✅ VideoCard with hover effects
 * ✅ Watch page with custom player UI
 * ✅ Comments section (mock)
 * ✅ Subscribe/Like (local state)
 *
 * Coming in future tasks:
 * ❌ Task 1: Real comments with multilingual support + moderation
 * ❌ Task 2: Controlled video downloads
 * ❌ Task 3: Subscriptions with Razorpay payments
 * ❌ Task 4: Authentication + theme preferences
 * ❌ Task 5: Real HTML5 video streaming player
 * ❌ Task 6: Real-time video calling
 */

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
