// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(serde::Serialize)]
struct LoginResponse {
    success: bool,
    message: String,
    token: Option<String>,
}

#[derive(serde::Serialize)]
struct QrCodeResponse {
    qr_code: String,
}

#[tauri::command]
fn primary_login(phone_number: &str, pin_code: &str) -> LoginResponse {
    // TODO: Implement actual LINE primary login logic
    if phone_number.is_empty() || pin_code.len() != 6 {
        return LoginResponse {
            success: false,
            message: "電話番号と6桁のPINコードを入力してください".to_string(),
            token: None,
        };
    }

    // Mock implementation
    LoginResponse {
        success: true,
        message: "ログイン成功".to_string(),
        token: Some("mock_token_123456".to_string()),
    }
}

#[tauri::command]
fn generate_qr_code() -> QrCodeResponse {
    // TODO: Implement actual LINE QR code generation
    // For now, return a mock QR code (base64 encoded)
    // This should be replaced with actual LINE QR code generation logic
    QrCodeResponse {
        qr_code: "mock_qr_code_base64".to_string(),
    }
}

#[tauri::command]
fn verify_pin_code(pin_code: &str) -> LoginResponse {
    // TODO: Implement actual LINE PIN code verification
    if pin_code.len() != 6 {
        return LoginResponse {
            success: false,
            message: "6桁のPINコードを入力してください".to_string(),
            token: None,
        };
    }

    // Mock implementation
    LoginResponse {
        success: true,
        message: "認証成功".to_string(),
        token: Some("mock_token_secondary_789012".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            primary_login,
            generate_qr_code,
            verify_pin_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
