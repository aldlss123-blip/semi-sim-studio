use serde::Serialize;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

#[repr(C)]
struct MultiLayerMeshBuffer {
    sub_vertices: *mut f32,
    sub_float_count: i32,
    film_vertices: *mut f32,
    film_float_count: i32,
}

unsafe extern "C" {
    fn generate_multilayer_mesh(
        etch_depth: f32,
        dep_thickness: f32,
        resolution: i32,
    ) -> MultiLayerMeshBuffer;
    fn free_multilayer_mesh(buf: MultiLayerMeshBuffer);
}

#[derive(Serialize)]
struct MultiLayerMeshJson {
    substrate: Vec<f32>,
    film: Vec<f32>,
}

fn write_usda_mesh(
    w: &mut BufWriter<File>,
    name: &str,
    verts: &[f32],
    color: (f32, f32, f32),
) -> std::io::Result<()> {
    let vert_count = verts.len() / 3;
    let tri_count = vert_count / 3;
    if tri_count == 0 {
        return Ok(());
    }

    writeln!(w, "    def Mesh \"{name}\"")?;
    writeln!(w, "    {{")?;

    // faceVertexCounts
    write!(w, "        int[] faceVertexCounts = [")?;
    for i in 0..tri_count {
        if i > 0 {
            write!(w, ", ")?;
        }
        write!(w, "3")?;
    }
    writeln!(w, "]")?;

    // faceVertexIndices
    write!(w, "        int[] faceVertexIndices = [")?;
    for i in 0..vert_count {
        if i > 0 {
            write!(w, ", ")?;
        }
        write!(w, "{i}")?;
    }
    writeln!(w, "]")?;

    // points
    write!(w, "        point3f[] points = [")?;
    for i in 0..vert_count {
        if i > 0 {
            write!(w, ", ")?;
        }
        let x = verts[i * 3];
        let y = verts[i * 3 + 1];
        let z = verts[i * 3 + 2];
        write!(w, "({x:.5}, {y:.5}, {z:.5})")?;
    }
    writeln!(w, "]")?;

    // displayColor
    writeln!(
        w,
        "        color3f[] primvars:displayColor = [({:.3}, {:.3}, {:.3})]",
        color.0, color.1, color.2
    )?;
    writeln!(w, "    }}")?;
    Ok(())
}

// 1) Binary IPC
#[tauri::command]
fn simulate_process(
    etch_depth: f32,
    dep_thickness: f32,
    resolution: i32,
) -> Result<tauri::ipc::Response, String> {
    let buf = unsafe { generate_multilayer_mesh(etch_depth, dep_thickness, resolution) };

    let sub_count = buf.sub_float_count.max(0) as usize;
    let film_count = buf.film_float_count.max(0) as usize;
    let total_bytes = 8 + (sub_count + film_count) * 4;

    let mut out = Vec::with_capacity(total_bytes);
    out.extend_from_slice(&(sub_count as u32).to_le_bytes());
    out.extend_from_slice(&(film_count as u32).to_le_bytes());

    unsafe {
        if !buf.sub_vertices.is_null() && sub_count > 0 {
            let sub_slice =
                std::slice::from_raw_parts(buf.sub_vertices as *const u8, sub_count * 4);
            out.extend_from_slice(sub_slice);
        }
        if !buf.film_vertices.is_null() && film_count > 0 {
            let film_slice =
                std::slice::from_raw_parts(buf.film_vertices as *const u8, film_count * 4);
            out.extend_from_slice(film_slice);
        }
        free_multilayer_mesh(buf);
    }

    Ok(tauri::ipc::Response::new(out))
}

// 2) JSON IPC (벤치마크 비교용)
#[tauri::command]
fn simulate_process_json(
    etch_depth: f32,
    dep_thickness: f32,
    resolution: i32,
) -> Result<MultiLayerMeshJson, String> {
    let buf = unsafe { generate_multilayer_mesh(etch_depth, dep_thickness, resolution) };

    let sub_count = buf.sub_float_count.max(0) as usize;
    let film_count = buf.film_float_count.max(0) as usize;

    let (substrate, film) = unsafe {
        let sub = if !buf.sub_vertices.is_null() && sub_count > 0 {
            std::slice::from_raw_parts(buf.sub_vertices, sub_count).to_vec()
        } else {
            Vec::new()
        };
        let flm = if !buf.film_vertices.is_null() && film_count > 0 {
            std::slice::from_raw_parts(buf.film_vertices, film_count).to_vec()
        } else {
            Vec::new()
        };
        free_multilayer_mesh(buf);
        (sub, flm)
    };

    Ok(MultiLayerMeshJson { substrate, film })
}

// 3) OpenUSD (.usda) 익스포트
#[tauri::command]
fn export_usda(
    etch_depth: f32,
    dep_thickness: f32,
    resolution: i32,
) -> Result<String, String> {
    let buf = unsafe { generate_multilayer_mesh(etch_depth, dep_thickness, resolution) };
    let sub_count = buf.sub_float_count.max(0) as usize;
    let film_count = buf.film_float_count.max(0) as usize;

    let (sub_verts, film_verts) = unsafe {
        let sub = if !buf.sub_vertices.is_null() && sub_count > 0 {
            std::slice::from_raw_parts(buf.sub_vertices, sub_count).to_vec()
        } else {
            Vec::new()
        };
        let flm = if !buf.film_vertices.is_null() && film_count > 0 {
            std::slice::from_raw_parts(buf.film_vertices, film_count).to_vec()
        } else {
            Vec::new()
        };
        free_multilayer_mesh(buf);
        (sub, flm)
    };

    let export_dir = PathBuf::from("../exports");
    fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let filename = format!(
        "wafer_etch{:.2}_dep{:.2}_res{}.usda",
        etch_depth, dep_thickness, resolution
    );
    let file_path = export_dir.join(&filename);
    let file = File::create(&file_path).map_err(|e| e.to_string())?;
    let mut w = BufWriter::new(file);

    writeln!(w, "#usda 1.0").map_err(|e| e.to_string())?;
    writeln!(w, "(").map_err(|e| e.to_string())?;
    writeln!(w, "    defaultPrim = \"WaferProcess\"").map_err(|e| e.to_string())?;
    writeln!(w, "    metersPerUnit = 1.0").map_err(|e| e.to_string())?;
    writeln!(w, "    upAxis = \"Y\"").map_err(|e| e.to_string())?;
    writeln!(w, ")\n").map_err(|e| e.to_string())?;

    writeln!(w, "def Xform \"WaferProcess\"").map_err(|e| e.to_string())?;
    writeln!(w, "{{").map_err(|e| e.to_string())?;

    write_usda_mesh(&mut w, "SiliconSubstrate", &sub_verts, (0.36, 0.43, 0.52))
        .map_err(|e| e.to_string())?;
    write_usda_mesh(&mut w, "DepositionFilm", &film_verts, (0.92, 0.66, 0.20))
        .map_err(|e| e.to_string())?;

    writeln!(w, "}}").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;

    let abs_path = fs::canonicalize(&file_path).unwrap_or(file_path);
    Ok(abs_path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            simulate_process,
            simulate_process_json,
            export_usda
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
