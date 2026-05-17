import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './Login.css';

interface LoginResponse {
  success: boolean;
  message: string;
  token?: string;
}

function Login() {
  const [loginType, setLoginType] = useState<'primary' | 'secondary'>('primary');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [qrCode, setQrCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'qr' | 'pin' | 'success'>('input');

  const handlePrimaryLogin = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await invoke<LoginResponse>('primary_login', { 
        phoneNumber,
        pinCode 
      });
      
      if (response.success) {
        setStep('success');
      } else {
        setError(response.message);
      }
    } catch (err) {
      setError('ログインに失敗しました');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSecondaryLogin = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await invoke<{ qrCode: string }>('generate_qr_code');
      setQrCode(response.qrCode);
      setStep('qr');
    } catch (err) {
      setError('QRコードの生成に失敗しました');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePinVerification = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await invoke<LoginResponse>('verify_pin_code', { 
        pinCode 
      });
      
      if (response.success) {
        setStep('success');
      } else {
        setError(response.message);
      }
    } catch (err) {
      setError('PINコードの認証に失敗しました');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePinChange = (value: string) => {
    if (value.length <= 6 && /^\d*$/.test(value)) {
      setPinCode(value);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">Vyline</h1>
        <p className="login-subtitle">Vision Beyond Limits</p>
        
        {step === 'input' && (
          <>
            <div className="login-type-selector">
              <button
                className={`login-type-button ${loginType === 'primary' ? 'active' : ''}`}
                onClick={() => setLoginType('primary')}
              >
                プライマリ端末
              </button>
              <button
                className={`login-type-button ${loginType === 'secondary' ? 'active' : ''}`}
                onClick={() => setLoginType('secondary')}
              >
                セカンダリ端末
              </button>
            </div>

            {loginType === 'primary' ? (
              <div className="login-form">
                <div className="form-group">
                  <label htmlFor="phoneNumber">電話番号</label>
                  <input
                    id="phoneNumber"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="09012345678"
                    className="form-input"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="pinCode">PINコード</label>
                  <input
                    id="pinCode"
                    type="password"
                    value={pinCode}
                    onChange={(e) => handlePinChange(e.target.value)}
                    placeholder="6桁のPINコード"
                    maxLength={6}
                    className="form-input"
                  />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button
                  onClick={handlePrimaryLogin}
                  disabled={loading || phoneNumber.length === 0 || pinCode.length !== 6}
                  className="login-button"
                >
                  {loading ? 'ログイン中...' : 'ログイン'}
                </button>
              </div>
            ) : (
              <div className="login-form">
                <p className="login-description">
                  セカンダリ端末としてログインするには、
                  プライマリ端末でQRコードをスキャンしてください。
                </p>

                {error && <div className="error-message">{error}</div>}

                <button
                  onClick={handleSecondaryLogin}
                  disabled={loading}
                  className="login-button"
                >
                  {loading ? 'QRコード生成中...' : 'QRコードを表示'}
                </button>
              </div>
            )}
          </>
        )}

        {step === 'qr' && (
          <div className="qr-code-section">
            <h2 className="qr-title">QRコードをスキャン</h2>
            <div className="qr-code-container">
              {qrCode ? (
                <img src={`data:image/png;base64,${qrCode}`} alt="QR Code" className="qr-code" />
              ) : (
                <div className="qr-loading">QRコードを生成中...</div>
              )}
            </div>
            <p className="qr-description">
              プライマリ端末のLINEアプリでこのQRコードをスキャンしてください
            </p>
            <button
              onClick={() => setStep('pin')}
              className="login-button"
            >
              PINコードを入力
            </button>
            <button
              onClick={() => setStep('input')}
              className="back-button"
            >
              戻る
            </button>
          </div>
        )}

        {step === 'pin' && (
          <div className="pin-section">
            <h2 className="pin-title">PINコードを入力</h2>
            <p className="pin-description">
              プライマリ端末に表示されたPINコードを入力してください
            </p>
            
            <div className="pin-input-container">
              <input
                type="text"
                value={pinCode}
                onChange={(e) => handlePinChange(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="pin-input"
                autoFocus
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              onClick={handlePinVerification}
              disabled={loading || pinCode.length !== 6}
              className="login-button"
            >
              {loading ? '認証中...' : '認証'}
            </button>
            <button
              onClick={() => setStep('qr')}
              className="back-button"
            >
              戻る
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="success-section">
            <div className="success-icon">✓</div>
            <h2 className="success-title">ログイン成功</h2>
            <p className="success-description">
              Vylineへようこそ！
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
