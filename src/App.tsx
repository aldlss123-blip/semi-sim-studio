import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  Plane,
  Scene,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import "./App.css";

interface MultiLayerMeshJson {
  substrate: number[];
  film: number[];
}

function buildMesh(
  name: string,
  positions: Float32Array,
  scene: Scene,
  material: StandardMaterial
): Mesh | null {
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) return null;

  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;

  const normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: true });

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, true);
  mesh.material = material;
  return mesh;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const subMeshRef = useRef<Mesh | null>(null);
  const filmMeshRef = useRef<Mesh | null>(null);
  const subMatRef = useRef<StandardMaterial | null>(null);
  const filmMatRef = useRef<StandardMaterial | null>(null);
  const reqIdRef = useRef<number>(0);

  const [etchDepth, setEtchDepth] = useState<number>(0.54);
  const [depThickness, setDepThickness] = useState<number>(0.10);
  const [resolution, setResolution] = useState<number>(40);
  const [clipEnabled, setClipEnabled] = useState<boolean>(true);
  const [clipZ, setClipZ] = useState<number>(0.0);
  const [showSubstrate, setShowSubstrate] = useState<boolean>(true);
  const [showFilm, setShowFilm] = useState<boolean>(true);
  const [wireframe, setWireframe] = useState<boolean>(false);

  const [ipcMode, setIpcMode] = useState<"binary" | "json">("binary");
  const [benchRunning, setBenchRunning] = useState<boolean>(false);
  const [benchResult, setBenchResult] = useState<{
    binaryMs: number;
    jsonMs: number;
    payloadKB: number;
  } | null>(null);

  const [exporting, setExporting] = useState<boolean>(false);
  const [exportMsg, setExportMsg] = useState<string>("");

  const [hud, setHud] = useState({
    status: "Initializing...",
    subTris: 0,
    filmTris: 0,
    totalMs: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.07, 0.09, 0.13, 1.0);
    sceneRef.current = scene;

    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 3,
      Math.PI / 3,
      4.2,
      new Vector3(0, -0.1, 0),
      scene
    );
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.01;
    camera.minZ = 0.05;

    const hemiLight = new HemisphericLight("hemi", new Vector3(0.3, 1, 0.2), scene);
    hemiLight.intensity = 0.7;

    const dirLight = new DirectionalLight("dir", new Vector3(-0.5, -1.0, -0.6), scene);
    dirLight.intensity = 0.9;

    const subMat = new StandardMaterial("substrateMat", scene);
    subMat.diffuseColor = new Color3(0.36, 0.43, 0.52);
    subMat.specularColor = new Color3(0.35, 0.38, 0.42);
    subMat.backFaceCulling = false;
    subMatRef.current = subMat;

    const filmMat = new StandardMaterial("filmMat", scene);
    filmMat.diffuseColor = new Color3(0.92, 0.66, 0.20);
    filmMat.specularColor = new Color3(0.5, 0.45, 0.3);
    filmMat.backFaceCulling = false;
    filmMatRef.current = filmMat;

    engine.runRenderLoop(() => {
      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      engine.dispose();
      sceneRef.current = null;
      subMeshRef.current = null;
      filmMeshRef.current = null;
      subMatRef.current = null;
      filmMatRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const subMat = subMatRef.current;
    const filmMat = filmMatRef.current;
    if (!scene || !subMat || !filmMat) return;

    const currentReqId = ++reqIdRef.current;

    const runSimulation = async () => {
      try {
        const t0 = performance.now();
        let subPositions: Float32Array;
        let filmPositions: Float32Array;

        if (ipcMode === "binary") {
          const buffer = await invoke<ArrayBuffer>("simulate_process", {
            etchDepth,
            depThickness,
            resolution,
          });
          const header = new Uint32Array(buffer, 0, 2);
          subPositions = new Float32Array(buffer, 8, header[0]);
          filmPositions = new Float32Array(buffer, 8 + header[0] * 4, header[1]);
        } else {
          const res = await invoke<MultiLayerMeshJson>("simulate_process_json", {
            etchDepth,
            depThickness,
            resolution,
          });
          subPositions = new Float32Array(res.substrate);
          filmPositions = new Float32Array(res.film);
        }

        const totalMs = performance.now() - t0;
        if (currentReqId !== reqIdRef.current || !sceneRef.current) return;

        if (subMeshRef.current) subMeshRef.current.dispose();
        if (filmMeshRef.current) filmMeshRef.current.dispose();

        subMeshRef.current = buildMesh("substrate_mesh", subPositions, scene, subMat);
        filmMeshRef.current = buildMesh("film_mesh", filmPositions, scene, filmMat);

        if (subMeshRef.current) subMeshRef.current.isVisible = showSubstrate;
        if (filmMeshRef.current) filmMeshRef.current.isVisible = showFilm;

        setHud({
          status: ipcMode === "binary" ? "Binary IPC (Zero-copy)" : "JSON IPC (serde_json)",
          subTris: Math.floor(subPositions.length / 9),
          filmTris: Math.floor(filmPositions.length / 9),
          totalMs,
        });
      } catch (err) {
        if (currentReqId === reqIdRef.current) {
          setHud((prev) => ({ ...prev, status: `Error: ${String(err)}` }));
        }
      }
    };

    runSimulation();
  }, [etchDepth, depThickness, resolution, ipcMode]);

  const runBenchmark = async () => {
    setBenchRunning(true);
    try {
      const runs = 3;
      let binTotal = 0;
      let jsonTotal = 0;
      let payloadBytes = 0;

      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const buf = await invoke<ArrayBuffer>("simulate_process", {
          etchDepth,
          depThickness,
          resolution,
        });
        const header = new Uint32Array(buf, 0, 2);
        new Float32Array(buf, 8, header[0]);
        new Float32Array(buf, 8 + header[0] * 4, header[1]);
        binTotal += performance.now() - t0;
        payloadBytes = buf.byteLength;
      }

      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const res = await invoke<MultiLayerMeshJson>("simulate_process_json", {
          etchDepth,
          depThickness,
          resolution,
        });
        new Float32Array(res.substrate);
        new Float32Array(res.film);
        jsonTotal += performance.now() - t0;
      }

      setBenchResult({
        binaryMs: binTotal / runs,
        jsonMs: jsonTotal / runs,
        payloadKB: payloadBytes / 1024,
      });
    } finally {
      setBenchRunning(false);
    }
  };

  const handleExportUsda = async () => {
    setExporting(true);
    setExportMsg("");
    try {
      const t0 = performance.now();
      const savedPath = await invoke<string>("export_usda", {
        etchDepth,
        depThickness,
        resolution,
      });
      const elapsed = performance.now() - t0;
      const shortName = savedPath.split("/").pop() || savedPath;
      setExportMsg(`Saved: exports/${shortName} (${elapsed.toFixed(0)} ms)`);
    } catch (err) {
      setExportMsg(`Export failed: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.clipPlane = clipEnabled ? new Plane(0, 0, 1, -clipZ) : null;
    }
  }, [clipEnabled, clipZ]);

  useEffect(() => {
    if (subMeshRef.current) subMeshRef.current.isVisible = showSubstrate;
  }, [showSubstrate]);

  useEffect(() => {
    if (filmMeshRef.current) filmMeshRef.current.isVisible = showFilm;
  }, [showFilm]);

  useEffect(() => {
    if (subMatRef.current) subMatRef.current.wireframe = wireframe;
    if (filmMatRef.current) filmMatRef.current.wireframe = wireframe;
  }, [wireframe]);

  return (
    <div className="viewport-container">
      <canvas ref={canvasRef} className="render-canvas" />

      <div className="hud-panel">
        <div className="hud-title">Semi-Sim Studio</div>
        <div className="hud-row">Mode: {hud.status}</div>
        <div className="hud-row">Substrate Tris: {hud.subTris.toLocaleString()}</div>
        <div className="hud-row">Film Layer Tris: {hud.filmTris.toLocaleString()}</div>
        <div className="hud-row">Sim + IPC: {hud.totalMs.toFixed(2)} ms</div>
      </div>

      <div className="control-panel">
        <div className="panel-section-title">Process Parameters</div>

        <label className="control-item">
          <div className="control-header">
            <span>Etch Depth</span>
            <span>{etchDepth.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={0.85}
            step={0.01}
            value={etchDepth}
            onChange={(e) => setEtchDepth(parseFloat(e.target.value))}
          />
        </label>

        <label className="control-item">
          <div className="control-header">
            <span>Deposition Thickness</span>
            <span>{depThickness.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={0.30}
            step={0.01}
            value={depThickness}
            onChange={(e) => setDepThickness(parseFloat(e.target.value))}
          />
        </label>

        <label className="control-item">
          <div className="control-header">
            <span>Voxel Resolution</span>
            <span>{resolution}³</span>
          </div>
          <input
            type="range"
            min={24}
            max={64}
            step={8}
            value={resolution}
            onChange={(e) => setResolution(parseInt(e.target.value, 10))}
          />
        </label>

        <div className="panel-divider" />
        <div className="panel-section-title">Material Layers</div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showSubstrate}
            onChange={(e) => setShowSubstrate(e.target.checked)}
          />
          <span style={{ color: "#94a3b8" }}>■</span>
          <span>Silicon Substrate</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showFilm}
            onChange={(e) => setShowFilm(e.target.checked)}
          />
          <span style={{ color: "#eab308" }}>■</span>
          <span>Deposition Film</span>
        </label>

        <div className="panel-divider" />
        <div className="panel-section-title">Cross-Section & View</div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={clipEnabled}
            onChange={(e) => setClipEnabled(e.target.checked)}
          />
          <span>Enable Z-Axis Clipping Plane</span>
        </label>

        <label className="control-item">
          <div className="control-header">
            <span>Clip Position (Z)</span>
            <span>{clipZ.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={-1.3}
            max={1.3}
            step={0.02}
            disabled={!clipEnabled}
            value={clipZ}
            onChange={(e) => setClipZ(parseFloat(e.target.value))}
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(e) => setWireframe(e.target.checked)}
          />
          <span>Wireframe Mode</span>
        </label>

        <div className="panel-divider" />
        <div className="panel-section-title">IPC Benchmark (Binary vs JSON)</div>

        <div className="mode-toggle">
          <button
            className={ipcMode === "binary" ? "mode-btn active" : "mode-btn"}
            onClick={() => setIpcMode("binary")}
          >
            Binary IPC
          </button>
          <button
            className={ipcMode === "json" ? "mode-btn active" : "mode-btn"}
            onClick={() => setIpcMode("json")}
          >
            JSON IPC
          </button>
        </div>

        <button className="bench-btn" onClick={runBenchmark} disabled={benchRunning}>
          {benchRunning ? "Running Benchmark..." : "Run Benchmark (3x Avg)"}
        </button>

        {benchResult && (
          <div className="bench-result">
            <div>Payload: {benchResult.payloadKB.toFixed(1)} KB</div>
            <div>Binary: <strong>{benchResult.binaryMs.toFixed(2)} ms</strong></div>
            <div>JSON: <strong>{benchResult.jsonMs.toFixed(2)} ms</strong></div>
            <div className="bench-speedup">
              Speedup: {(benchResult.jsonMs / Math.max(benchResult.binaryMs, 0.01)).toFixed(1)}x faster
            </div>
          </div>
        )}

        <div className="panel-divider" />
        <div className="panel-section-title">OpenUSD Asset Export</div>

        <button className="export-btn" onClick={handleExportUsda} disabled={exporting}>
          {exporting ? "Exporting .usda..." : "Export OpenUSD (.usda)"}
        </button>

        {exportMsg && <div className="export-msg">{exportMsg}</div>}
      </div>
    </div>
  );
}

export default App;
