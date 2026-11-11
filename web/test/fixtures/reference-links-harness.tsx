import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { createReferenceLinkResolver } from "../../src/components/generation-reference-links";

function Harness() {
    const { modal } = App.useApp();
    const [result, setResult] = useState("idle");
    const start = async () => {
        const resolver = createReferenceLinkResolver(modal);
        const refs = [{ key: "image:0", label: "Reference picture 1", name: "Character reference picture.png" }, { key: "video:0", label: "Reference video 1", name: "Reference action.mp4" }];
        const [first, second] = await Promise.all([resolver(refs), resolver(refs)]);
        setResult(first === second && first ? "confirmed" : "cancelled");
    };
    return <><button onClick={() => void start()}>generate</button><output>{result}</output></>;
}
const dark = new URLSearchParams(location.search).has("dark");
createRoot(document.getElementById("root")!).render(<ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { motion: false } }}><App><Harness /></App></ConfigProvider>);
