import Live2DView from "./components/Live2DView";

function App() {
    console.log("✅ App 渲染中");

    return (
        <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
            <Live2DView />
        </div>
    );
}

export default App;
