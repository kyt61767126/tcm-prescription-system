import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/Login';
import HomePage from './pages/Home';
import PrescriptionListPage from './pages/PrescriptionList';
import MedicineLibraryPage from './pages/MedicineLibrary';
import FormulaLibraryPage from './pages/FormulaLibrary';
import ProfilePage from './pages/Profile';
import PreviewPage from './pages/Preview';
import { MainLayout } from './components/Layout/MainLayout';
import './App.css';

function App() {
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);

  if (!hasHydrated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e0e0e0' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', border: '4px solid #008000', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: '#666', fontSize: '14px' }}>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {!user ? (
          <Route path="*" element={<Navigate to="/login" />} />
        ) : (
          <>
            <Route path="/" element={<MainLayout variant="app"><HomePage /></MainLayout>} />
            <Route path="/prescriptions" element={<MainLayout variant="app"><PrescriptionListPage /></MainLayout>} />
            <Route path="/medicines" element={<MainLayout variant="app"><MedicineLibraryPage /></MainLayout>} />
            <Route path="/formulas" element={<MainLayout variant="app"><FormulaLibraryPage /></MainLayout>} />
            <Route path="/profile" element={<MainLayout variant="app"><ProfilePage /></MainLayout>} />
            <Route path="/preview" element={<PreviewPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>
        )}
      </Routes>
    </Router>
  );
}

export default App;