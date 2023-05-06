import { vscode } from "./utilities/vscode";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./App.css";

function App() {
    function handleHowdyClick() {
        vscode.postMessage({
            command: "hello",
            text: "Hey there from webview_search 🤠",
        });
    }

    return (
        <main>
            <h1>Webview search</h1>
            <VSCodeButton onClick={handleHowdyClick}>Howdy!</VSCodeButton>
        </main>
    );
}

export default App;