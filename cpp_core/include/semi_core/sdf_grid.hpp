#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace semi_core {

struct Vec3 {
    float x, y, z;
};

class SdfGrid {
public:
    int32_t nx, ny, nz;
    float min_x, min_y, min_z;
    float dx, dy, dz;
    std::vector<float> data;

    SdfGrid(int32_t res_x, int32_t res_y, int32_t res_z,
            Vec3 bmin, Vec3 bmax)
        : nx(res_x), ny(res_y), nz(res_z),
          min_x(bmin.x), min_y(bmin.y), min_z(bmin.z),
          dx((bmax.x - bmin.x) / static_cast<float>(res_x - 1)),
          dy((bmax.y - bmin.y) / static_cast<float>(res_y - 1)),
          dz((bmax.z - bmin.z) / static_cast<float>(res_z - 1)),
          data(static_cast<size_t>(res_x) * res_y * res_z, 1.0f) {}

    inline float& at(int32_t x, int32_t y, int32_t z) {
        return data[(static_cast<size_t>(z) * ny + y) * nx + x];
    }

    inline float at(int32_t x, int32_t y, int32_t z) const {
        return data[(static_cast<size_t>(z) * ny + y) * nx + x];
    }

    inline Vec3 pos(int32_t x, int32_t y, int32_t z) const {
        return {min_x + x * dx, min_y + y * dy, min_z + z * dz};
    }

    static float sd_box(Vec3 p, Vec3 center, Vec3 half_extents) {
        float qx = std::abs(p.x - center.x) - half_extents.x;
        float qy = std::abs(p.y - center.y) - half_extents.y;
        float qz = std::abs(p.z - center.z) - half_extents.z;

        float ox = std::max(qx, 0.0f);
        float oy = std::max(qy, 0.0f);
        float oz = std::max(qz, 0.0f);
        float outside = std::sqrt(ox * ox + oy * oy + oz * oz);
        float inside = std::min(std::max({qx, qy, qz}), 0.0f);
        return outside + inside;
    }

    // 기판(Substrate)과 증착막(Film) 두 개의 SDF 그리드를 동시에 생성
    static void build_multilayer_process(
        SdfGrid& substrate_grid,
        SdfGrid& film_grid,
        float etch_depth,
        float dep_thickness) {

        const Vec3 wafer_center{0.0f, -0.25f, 0.0f};
        const Vec3 wafer_half{1.2f, 0.55f, 1.2f}; // 상단 y = 0.30, 하단 y = -0.80

        const float trench_half_w = 0.35f;
        const float top_y = wafer_center.y + wafer_half.y;
        const float clamped_etch = std::clamp(etch_depth, 0.0f, 0.9f);
        const Vec3 trench_center{0.0f, top_y - clamped_etch * 0.5f + 0.1f, 0.0f};
        const Vec3 trench_half{trench_half_w, clamped_etch * 0.5f + 0.1f, 1.4f};

        const float clamped_dep = std::clamp(dep_thickness, 0.0f, 0.35f);
        const bool has_film = clamped_dep > 0.002f;
        constexpr float interface_eps = 0.003f; // 경계면 Z-fighting 방지 오프셋

        for (int32_t z = 0; z < substrate_grid.nz; ++z) {
            for (int32_t y = 0; y < substrate_grid.ny; ++y) {
                for (int32_t x = 0; x < substrate_grid.nx; ++x) {
                    Vec3 p = substrate_grid.pos(x, y, z);

                    // 1. 실리콘 기판 + 식각(CSG Subtraction)
                    float d_wafer = sd_box(p, wafer_center, wafer_half);
                    float d_etched = d_wafer;
                    if (clamped_etch > 0.001f) {
                        float d_trench = sd_box(p, trench_center, trench_half);
                        d_etched = std::max(d_wafer, -d_trench);
                    }

                    // 웨이퍼 외곽 및 하단 경계 클리핑
                    float d_bounds = sd_box(p, {0.0f, 0.0f, 0.0f}, {1.2f, 0.8f, 1.2f});
                    float d_sub = std::max(d_etched, d_bounds);
                    substrate_grid.at(x, y, z) = d_sub;

                    // 2. 등각 증착막 (전체 확장 형상에서 기판 영역을 차집합)
                    if (has_film) {
                        float d_total = std::max(d_etched - clamped_dep, d_bounds);
                        film_grid.at(x, y, z) = std::max(d_total, -(d_sub - interface_eps));
                    } else {
                        film_grid.at(x, y, z) = 1.0f;
                    }
                }
            }
        }
    }
};

} // namespace semi_core
