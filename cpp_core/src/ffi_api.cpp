#include "semi_core/marching_cubes.hpp"
#include "semi_core/sdf_grid.hpp"

#include <cstdint>
#include <cstring>

extern "C" {

struct MultiLayerMeshBuffer {
    float* sub_vertices;
    int32_t sub_float_count;
    float* film_vertices;
    int32_t film_float_count;
};

MultiLayerMeshBuffer generate_multilayer_mesh(
    float etch_depth, float dep_thickness, int32_t resolution) {

    int32_t res = (resolution < 16) ? 16 : (resolution > 96 ? 96 : resolution);
    semi_core::Vec3 bmin{-1.5f, -1.1f, -1.5f};
    semi_core::Vec3 bmax{ 1.5f,  1.1f,  1.5f};

    semi_core::SdfGrid sub_grid(res, res, res, bmin, bmax);
    semi_core::SdfGrid film_grid(res, res, res, bmin, bmax);
    semi_core::SdfGrid::build_multilayer_process(sub_grid, film_grid, etch_depth, dep_thickness);

    std::vector<float> sub_verts = semi_core::extract_isosurface(sub_grid);
    std::vector<float> film_verts;
    if (dep_thickness > 0.002f) {
        film_verts = semi_core::extract_isosurface(film_grid);
    }

    MultiLayerMeshBuffer buf{nullptr, 0, nullptr, 0};
    if (!sub_verts.empty()) {
        buf.sub_float_count = static_cast<int32_t>(sub_verts.size());
        buf.sub_vertices = new float[sub_verts.size()];
        std::memcpy(buf.sub_vertices, sub_verts.data(), sub_verts.size() * sizeof(float));
    }
    if (!film_verts.empty()) {
        buf.film_float_count = static_cast<int32_t>(film_verts.size());
        buf.film_vertices = new float[film_verts.size()];
        std::memcpy(buf.film_vertices, film_verts.data(), film_verts.size() * sizeof(float));
    }
    return buf;
}

void free_multilayer_mesh(MultiLayerMeshBuffer buf) {
    delete[] buf.sub_vertices;
    delete[] buf.film_vertices;
}

} // extern "C"
