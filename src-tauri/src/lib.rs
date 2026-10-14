// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Converts a .ppt/.pptx (raw request body) to PDF bytes using the locally installed
/// PowerPoint (Windows, COM automation) or LibreOffice (`soffice`) as a fallback.
#[tauri::command]
async fn convert_ppt_to_pdf(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw presentation bytes".into());
    };
    let ext = request
        .headers()
        .get("x-ext")
        .and_then(|v| v.to_str().ok())
        .filter(|e| *e == "ppt" || *e == "pptx")
        .unwrap_or("pptx")
        .to_string();
    let bytes = bytes.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join(format!("inkwell-ppt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let input = dir.join(format!("input.{ext}"));
        let output = dir.join("output.pdf");
        std::fs::write(&input, &bytes).map_err(|e| e.to_string())?;

        let result = convert_with_powerpoint(&input, &output)
            .or_else(|pp_err| {
                convert_with_libreoffice(&input, &dir, &output)
                    .map_err(|lo_err| format!("PowerPoint: {pp_err}; LibreOffice: {lo_err}"))
            })
            .and_then(|_| std::fs::read(&output).map_err(|e| e.to_string()));
        let _ = std::fs::remove_dir_all(&dir);
        result
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn convert_with_powerpoint(input: &std::path::Path, output: &std::path::Path) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("PowerPoint automation is Windows-only".into());
    }
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open($env:INKWELL_IN, $true, $false, $false)
  $pres.SaveAs($env:INKWELL_OUT, 32)
  $pres.Close()
} finally { $ppt.Quit() }
"#;
    let out = hidden(
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
            .env("INKWELL_IN", input)
            .env("INKWELL_OUT", output),
    )
    .output()
    .map_err(|e| e.to_string())?;
    if out.status.success() && output.exists() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn convert_with_libreoffice(input: &std::path::Path, dir: &std::path::Path, output: &std::path::Path) -> Result<(), String> {
    let out = hidden(
        std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "pdf", "--outdir"])
            .arg(dir)
            .arg(input),
    )
    .output()
    .map_err(|e| e.to_string())?;
    // soffice names the result after the input file (input.pdf)
    let produced = dir.join("input.pdf");
    if out.status.success() && produced.exists() {
        std::fs::rename(produced, output).map_err(|e| e.to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, convert_ppt_to_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
