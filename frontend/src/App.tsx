import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Scanner from './pages/Scanner';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-cyber-bg text-cyber-text">
        <Navbar />
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
