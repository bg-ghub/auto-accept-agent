# Auto Accept Agent - System Architecture

## 1. Extension Host (Node.js Context)
// Manages lifecycle, CDP connection, and code injection

FUNCTION Activate(context):
    Register Command "auto-accept.toggle" -> Trigger ToggleLogic()
    Register Command "auto-accept.settings" -> Open SettingsPanel
    Initialize CDPConnection()

FUNCTION CDPConnection():
    // Connect to the IDE's own DevTools Protocol
    Socket = ConnectToWebSocket(Port)
    Target = FindPage(ProjectName) 
    
    IF Target Found:
        Session = AttachToTarget(Target.id)
        Enable DOM/Runtime Agents
        InjectScript(Read "full_cdp_script.js")
    ELSE:
        Retry()

## 2. Injected Script (Browser/Renderer Context)
// Monolithic script running inside the IDE's DOM

// A. Initialization & Security
GlobalState = { isRunning: false, sessionID: 0, tabNames: [] }

// Bypass strict CSP by cycling allowed policy names
Policy = TryCreatePolicy(["dompurify", "mermaid", "diffReview", ...])
FUNCTION SetHTML(el, html) -> el.innerHTML = Policy.createHTML(html)

// B. Main Execution Loops
FUNCTION StartAgent(Config):
    IF Config.Mode == "Background": 
        IF IDE == "Cursor": RunCursorLoop()
        ELSE: RunAntigravityLoop()
    ELSE: 
        RunSimplePollLoop()

FUNCTION RunCursorLoop():
    WHILE State.isRunning:
        // 1. Interaction Phase
        Buttons = FindElements(["button", ".ah-button"])
        FOR btn in Buttons:
            IF IsAcceptButton(btn) -> DispatchClick(btn)
        
        // 2. Tab Management Phase
        Tabs = FindElements("#workbench.parts.auxiliarybar .tab")
        State.tabNames = Tabs.map(ExtractName_And_StripTime)
        CycleNextTab() // Keep process alive
        
        // 3. UI Phase
        UpdateOverlay()
        Sleep(3000ms)

// C. UI Overlay System
FUNCTION UpdateOverlay():
    Overlay = GetElement("#__autoAcceptBgOverlay")
    
    // Phase 1: Creation & Attachment
    IF !Overlay:
        Create Styled Container (z-index: max)
        TargetPanel = Find("#workbench.parts.auxiliarybar")
        Attach ResizeObserver(TargetPanel -> Sync Overlay Position)
    
    // Phase 2: DOM Diffing (Prevents Flicker)
    ExistingSlots = GetSlots()
    FOR name in State.tabNames:
        IF Slot(name) exists:
            Update CSS classes (animate progress bar)
            Update Status Text ("WORKING" / "DONE")
        ELSE:
            Create New Slot using SetHTML()
    
    Remove Stale Slots()

## Useful information to note

### Antigravity Selectors
panel : #antigravity\.agentPanel
buttons: 

### Cursor Selectors

panel: #workbench\.parts\.auxiliarybar
buttons: 