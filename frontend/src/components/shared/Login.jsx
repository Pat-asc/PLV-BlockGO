// src/Login.jsx
import React, { useState } from 'react';
import '../../assets/App.css';
import plvbg from '../../assets/plvbg.png';
import plvlogo from '../../assets/plvlogo.png';
import { login, forgotPassword } from '../../services/api';
import { createLocalDevToken, createLocalDevTokenForRole } from '../../utils/localDevAuth';

const Login = ({ onLogin }) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [currentView, setCurrentView] = useState('signIn');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const localDevToken = createLocalDevToken(email);
      if (localDevToken) {
        onLogin(localDevToken);
        return;
      }

      const data = await login({ username: email, password: password });
      if (data.token) {
        await onLogin(data.token);
      } else {
        setError(data.error || "Login failed. Invalid email or password.");
      }
    } catch (error) {
      setError(error.message || "Error connecting to the server.");
    }
    setIsLoading(false);
  };

  const enterLocalPortal = (role) => {
    setError('');
    setMessage('');
    const token = createLocalDevTokenForRole(role);
    if (token) onLogin(token);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await forgotPassword(email);
      setMessage(data.message || 'Your request is pending with the Registrar.');
    } catch (error) {
      setError(error.message);
    }
    setIsLoading(false);
  };

  const renderPasswordInput = ({
    label,
    value,
    onChange,
    placeholder,
    autoComplete,
    isVisible,
    onToggle,
    helperText,
  }) => (
    <div className="input-group">
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={isVisible ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          required
          style={{ width: '100%', paddingRight: '44px' }}
        />
        {value ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={isVisible ? "Hide password" : "Show password"}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              color: '#64748b',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isVisible ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M10.58 10.58A2 2 0 0013.41 13.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.88 5.09A10.94 10.94 0 0112 4.91c5.05 0 9.27 3.11 10.5 7.5a10.74 10.74 0 01-3.04 4.57" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.61 6.62A10.77 10.77 0 001.5 12.41a10.75 10.75 0 004.2 5.42A10.89 10.89 0 0012 19.91c1.8 0 3.5-.43 5-1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M1.5 12s3.82-7.09 10.5-7.09S22.5 12 22.5 12s-3.82 7.09-10.5 7.09S1.5 12 1.5 12z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
      {helperText ? (
        <small style={{ color: '#dc2626', fontSize: '12px' }}>{helperText}</small>
      ) : null}
    </div>
  );

  return (
    <div className="login-container">
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
            vertical-align: middle;
          }
        `}
      </style>
      <div 
        className="login-image-section" 
        style={{ backgroundImage: `url(${plvbg})` }}
      >
        
    </div>

      <div className="login-form-section">
        <div className="login-card">
          <img src={plvlogo} alt="PLV Logo" className="plv-logo" />
          

          <h2 className="welcome-text">
            {currentView === 'signIn' && "Welcome"}
            {currentView === 'forgotPassword' && "Request Password Reset"}
          </h2>
          {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
          {message && <p style={{ color: 'green', textAlign: 'center' }}>{message}</p>}
          
          {/* SIGN IN FORM */}
          {currentView === 'signIn' && (
            <form className="login-form" onSubmit={handleLoginSubmit}>
              <div className="input-group">
                <label>Email or Student No.</label>
                <input 
                  type="text" 
                  placeholder="e.g. example@plv.edu.ph or 23-5055"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required 
                />
              </div>
              {renderPasswordInput({
                label: "Password",
                value: password,
                onChange: (e) => setPassword(e.target.value),
                placeholder: "Password",
                autoComplete: "current-password",
                isVisible: showPassword,
                onToggle: () => setShowPassword((current) => !current),
              })}
              <button type="submit" className="sign-in-btn" disabled={isLoading}>
                {isLoading ? (<><span className="spinner"></span> Signing In...</>) : 'Sign In'}
              </button>
              {process.env.NODE_ENV === 'development' && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #ddd' }}>
                  <p style={{ marginBottom: '8px', textAlign: 'center', color: '#666', fontSize: '13px' }}>
                    Local access — middleware authentication disabled
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button type="button" className="sign-in-btn" onClick={() => enterLocalPortal('system_admin')}>
                      Enter as System Admin
                    </button>
                    <button type="button" className="sign-in-btn" onClick={() => enterLocalPortal('registrar')}>
                      Enter as Registrar
                    </button>
                    <button type="button" className="sign-in-btn" onClick={() => enterLocalPortal('faculty')}>
                      Enter as Faculty
                    </button>
                    <button type="button" className="sign-in-btn" onClick={() => enterLocalPortal('department_admin')}>
                      Enter as Chairperson
                    </button>
                    <button type="button" className="sign-in-btn" onClick={() => enterLocalPortal('student')}>
                      Enter as Student
                    </button>
                  </div>
                </div>
              )}
              <p className="forgot-password auth-link" onClick={() => { setCurrentView('forgotPassword'); setError(''); setMessage(''); }} style={{ cursor: 'pointer', fontWeight: 'normal', marginTop: '10px', textAlign: 'center' }}>
                Forgot Password?
              </p>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {currentView === 'forgotPassword' && (
            <form className="login-form" onSubmit={handleForgotPassword}>
              
              <div className="input-group">
                <label>Email</label>
                <input type="email" placeholder="Your registered email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <button type="submit" className="sign-in-btn" disabled={isLoading}>
                {isLoading ? (<><span className="spinner"></span> Submitting...</>) : 'Submit Request'}
              </button>
              <p style={{ color: '#64748b', fontSize: '12px', lineHeight: 1.5, textAlign: 'center' }}>
                Faculty and Chairperson requests are reviewed by the Registrar. No password or verification code is sent by this form.
              </p>
            </form>
          )}

          {currentView === 'forgotPassword' && (
            <p className="toggle-view auth-link" onClick={() => { setCurrentView('signIn'); setError(''); setMessage(''); }} style={{ cursor: 'pointer', fontWeight: 'bold', marginTop: '15px' }}>
              Back to Sign In
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
export default Login;
