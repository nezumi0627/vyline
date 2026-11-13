import AppKit
import Foundation

final class VylineDelegate: NSObject, NSApplicationDelegate {
    private let environment = ProcessInfo.processInfo.environment
    private let resources = Bundle.main.resourceURL!
    private var dataRoot: URL {
        if let path = environment["VYLINE_LAUNCHER_DATA_ROOT"] { return URL(fileURLWithPath: path) }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Vyline", isDirectory: true)
    }
    private var port: Int {
        let value = Int(environment["VYLINE_LAUNCHER_PORT"] ?? "18765") ?? 18765
        return (1...65535).contains(value) ? value : 18765
    }
    private var appURL: URL { URL(string: "http://127.0.0.1:\(port)")! }
    private var backend: Process?
    private var backendLog: FileHandle?
    private var startupDeadline = Date()
    private var restarts = 0
    private var ready = false
    private var quitting = false
    private var terminationReplied = false
    private var signals: [DispatchSourceSignal] = []
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 1
        config.timeoutIntervalForResource = 2
        return URLSession(configuration: config)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()
        // AppKit owns the main run loop and reports the application as launched.
        // Backend/network work is asynchronous so it never stalls Dock events.
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signals.append(source)
        }
        checkHealth { healthy in
            guard !self.quitting else { return }
            if healthy {
                // A separately started server is reused, but is never owned or killed.
                self.ready = true
                self.openBrowser()
            } else {
                self.startBackend()
            }
        }
    }

    private func installMenu() {
        let bar = NSMenu()
        let item = NSMenuItem()
        bar.addItem(item)
        let menu = NSMenu()
        item.submenu = menu
        let open = NSMenuItem(title: NSLocalizedString("Open Vyline", comment: "Application menu"), action: #selector(openBrowser), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: NSLocalizedString("Quit Vyline", comment: "Application menu"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        NSApp.mainMenu = bar
    }

    @objc private func openBrowser() {
        guard ready, !quitting, environment["VYLINE_LAUNCHER_NO_BROWSER"] != "1" else { return }
        NSWorkspace.shared.open(appURL)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openBrowser()
        return false
    }

    private func checkHealth(_ completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: appURL.appendingPathComponent("healthz"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        session.dataTask(with: request) { data, response, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            let healthy = (response as? HTTPURLResponse)?.statusCode == 200 && json?["status"] as? String == "ready"
            DispatchQueue.main.async { completion(healthy) }
        }.resume()
    }

    private func startBackend() {
        guard !quitting else { return }
        ready = false
        let process = Process()
        process.executableURL = resources.appendingPathComponent("VylineBackend")
        process.currentDirectoryURL = resources
        var env = environment
        env.merge([
            "PORT": String(port),
            "VYLINE_HOST": "127.0.0.1",
            "VYLINE_LAN_ACCESS": "false",
            "VYLINE_CORS_ORIGIN": appURL.absoluteString,
            "VYLINE_STATIC_DIR": resources.appendingPathComponent("web").path,
            "VYLINE_OPENAPI_PATH": resources.appendingPathComponent("openapi.yaml").path,
            "VYLINE_DESKTOP_PROFILE_FALLBACK": resources.appendingPathComponent("data/desktop-profile.fallback.json").path,
            "VYLINE_DATA_DIR": dataRoot.appendingPathComponent("data").path,
            "VYLINE_STORAGE_DIR": dataRoot.appendingPathComponent("storage").path,
            "VYLINE_LOG_DIR": dataRoot.appendingPathComponent("data/logs").path,
            "VYLINE_CDN_CACHE_DIR": dataRoot.appendingPathComponent("storage/cache/cdn-cache").path,
            "VYLINE_ICON_CACHE_DIR": dataRoot.appendingPathComponent("storage/cache/icons").path,
            "VYLINE_MEDIA_STORAGE_DIR": dataRoot.appendingPathComponent("storage/saved-media").path,
        ], uniquingKeysWith: { _, value in value })
        process.environment = env
        process.standardInput = FileHandle.nullDevice
        do {
            let directory = dataRoot.appendingPathComponent("data/logs", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let logURL = directory.appendingPathComponent("backend.log")
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            backendLog = try FileHandle(forWritingTo: logURL)
            try backendLog?.seekToEnd()
            process.standardOutput = backendLog
            process.standardError = backendLog
            process.terminationHandler = { child in
                // terminateLater can run a nested AppKit event loop while the
                // main dispatch queue is occupied (for example after SIGTERM).
                RunLoop.main.perform(inModes: [.default, .modalPanel, .eventTracking]) {
                    self.backendExited(child)
                }
            }
            backend = process
            try process.run()
            startupDeadline = Date().addingTimeInterval(30)
            waitForBackend(process)
        } catch {
            backend = nil
            failStartup()
        }
    }

    private func waitForBackend(_ process: Process) {
        guard !quitting, backend === process, process.isRunning else { return }
        checkHealth { healthy in
            guard !self.quitting, self.backend === process, process.isRunning else { return }
            if healthy {
                self.ready = true
                self.openBrowser()
            } else if Date() >= self.startupDeadline {
                self.failStartup()
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForBackend(process) }
            }
        }
    }

    private func backendExited(_ process: Process) {
        guard backend === process else { return }
        backend = nil
        ready = false
        try? backendLog?.close()
        backendLog = nil
        if quitting {
            finishTermination()
        } else if process.terminationStatus == 0 {
            NSApp.terminate(nil)
        } else if restarts < 3 {
            restarts += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(restarts) * 0.5) { self.startBackend() }
        } else {
            failStartup()
        }
    }

    private func failStartup() {
        guard !quitting else { return }
        let alert = NSAlert()
        alert.messageText = NSLocalizedString("Vyline could not start", comment: "Startup failure")
        alert.informativeText = String(format: NSLocalizedString("The backend could not start. See the log for details:\n%@", comment: "Startup failure and log path"), dataRoot.appendingPathComponent("data/logs/backend.log").path)
        alert.addButton(withTitle: NSLocalizedString("Quit", comment: "Startup failure action"))
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitting = true
        guard let process = backend, process.isRunning else { return .terminateNow }
        process.terminate()
        // Give SQLite and active requests time to close, without blocking AppKit.
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        return .terminateLater
    }

    private func finishTermination() {
        guard !terminationReplied else { return }
        terminationReplied = true
        NSApp.reply(toApplicationShouldTerminate: true)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = VylineDelegate()
app.delegate = delegate
app.run()
