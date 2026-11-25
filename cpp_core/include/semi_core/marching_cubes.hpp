#pragma once

#include "semi_core/sdf_grid.hpp"
#include <cmath>
#include <vector>

namespace semi_core {

inline Vec3 interp_vertex(const Vec3& p1, const Vec3& p2, float v1, float v2) {
    float denom = v2 - v1;
    float t = (std::abs(denom) > 1e-6f) ? (-v1 / denom) : 0.5f;
    t = std::clamp(t, 0.0f, 1.0f);
    return {
        p1.x + t * (p2.x - p1.x),
        p1.y + t * (p2.y - p1.y),
        p1.z + t * (p2.z - p1.z)
    };
}

inline void emit_oriented_tri(std::vector<float>& out,
                              const Vec3& a, const Vec3& b, const Vec3& c,
                              const Vec3& outward_hint) {
    Vec3 ab{b.x - a.x, b.y - a.y, b.z - a.z};
    Vec3 ac{c.x - a.x, c.y - a.y, c.z - a.z};
    Vec3 n{
        ab.y * ac.z - ab.z * ac.y,
        ab.z * ac.x - ab.x * ac.z,
        ab.x * ac.y - ab.y * ac.x
    };
    float dot = n.x * outward_hint.x + n.y * outward_hint.y + n.z * outward_hint.z;
    if (dot >= 0.0f) {
        out.insert(out.end(), {a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z});
    } else {
        out.insert(out.end(), {a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z});
    }
}

inline void process_tetrahedron(std::vector<float>& out,
                                const Vec3 p[4], const float v[4]) {
    int inside[4], outside[4];
    int n_in = 0, n_out = 0;

    for (int i = 0; i < 4; ++i) {
        if (v[i] < 0.0f) inside[n_in++] = i;
        else outside[n_out++] = i;
    }

    if (n_in == 0 || n_in == 4) return;

    if (n_in == 1) {
        int i0 = inside[0];
        int o0 = outside[0], o1 = outside[1], o2 = outside[2];
        Vec3 a = interp_vertex(p[i0], p[o0], v[i0], v[o0]);
        Vec3 b = interp_vertex(p[i0], p[o1], v[i0], v[o1]);
        Vec3 c = interp_vertex(p[i0], p[o2], v[i0], v[o2]);
        Vec3 hint{
            (p[o0].x + p[o1].x + p[o2].x) / 3.0f - p[i0].x,
            (p[o0].y + p[o1].y + p[o2].y) / 3.0f - p[i0].y,
            (p[o0].z + p[o1].z + p[o2].z) / 3.0f - p[i0].z
        };
        emit_oriented_tri(out, a, b, c, hint);
    } else if (n_in == 3) {
        int o0 = outside[0];
        int i0 = inside[0], i1 = inside[1], i2 = inside[2];
        Vec3 a = interp_vertex(p[o0], p[i0], v[o0], v[i0]);
        Vec3 b = interp_vertex(p[o0], p[i1], v[o0], v[i1]);
        Vec3 c = interp_vertex(p[o0], p[i2], v[o0], v[i2]);
        Vec3 hint{
            p[o0].x - (p[i0].x + p[i1].x + p[i2].x) / 3.0f,
            p[o0].y - (p[i0].y + p[i1].y + p[i2].y) / 3.0f,
            p[o0].z - (p[i0].z + p[i1].z + p[i2].z) / 3.0f
        };
        emit_oriented_tri(out, a, b, c, hint);
    } else { // n_in == 2, n_out == 2
        int i0 = inside[0], i1 = inside[1];
        int o0 = outside[0], o1 = outside[1];
        Vec3 a = interp_vertex(p[i0], p[o0], v[i0], v[o0]);
        Vec3 b = interp_vertex(p[i0], p[o1], v[i0], v[o1]);
        Vec3 c = interp_vertex(p[i1], p[o1], v[i1], v[o1]);
        Vec3 d = interp_vertex(p[i1], p[o0], v[i1], v[o0]);
        Vec3 hint{
            (p[o0].x + p[o1].x) * 0.5f - (p[i0].x + p[i1].x) * 0.5f,
            (p[o0].y + p[o1].y) * 0.5f - (p[i0].y + p[i1].y) * 0.5f,
            (p[o0].z + p[o1].z) * 0.5f - (p[i0].z + p[i1].z) * 0.5f
        };
        emit_oriented_tri(out, a, b, c, hint);
        emit_oriented_tri(out, a, c, d, hint);
    }
}

inline std::vector<float> extract_isosurface(const SdfGrid& grid) {
    std::vector<float> vertices;
    vertices.reserve(static_cast<size_t>(grid.nx) * grid.ny * 18);

    static constexpr int tets[6][4] = {
        {0, 5, 1, 6}, {0, 1, 2, 6}, {0, 2, 3, 6},
        {0, 3, 7, 6}, {0, 7, 4, 6}, {0, 4, 5, 6}
    };

    for (int32_t z = 0; z < grid.nz - 1; ++z) {
        for (int32_t y = 0; y < grid.ny - 1; ++y) {
            for (int32_t x = 0; x < grid.nx - 1; ++x) {
                Vec3 cp[8] = {
                    grid.pos(x,     y,     z),
                    grid.pos(x + 1, y,     z),
                    grid.pos(x + 1, y + 1, z),
                    grid.pos(x,     y + 1, z),
                    grid.pos(x,     y,     z + 1),
                    grid.pos(x + 1, y,     z + 1),
                    grid.pos(x + 1, y + 1, z + 1),
                    grid.pos(x,     y + 1, z + 1)
                };
                float cv[8] = {
                    grid.at(x,     y,     z),
                    grid.at(x + 1, y,     z),
                    grid.at(x + 1, y + 1, z),
                    grid.at(x,     y + 1, z),
                    grid.at(x,     y,     z + 1),
                    grid.at(x + 1, y,     z + 1),
                    grid.at(x + 1, y + 1, z + 1),
                    grid.at(x,     y + 1, z + 1)
                };

                // 빠른 스킵: 8개 꼭짓점의 부호가 모두 같으면 등치면 없음
                bool all_neg = true, all_pos = true;
                for (int i = 0; i < 8; ++i) {
                    if (cv[i] < 0.0f) all_pos = false;
                    else all_neg = false;
                }
                if (all_neg || all_pos) continue;

                for (int t = 0; t < 6; ++t) {
                    Vec3 tp[4] = {cp[tets[t][0]], cp[tets[t][1]], cp[tets[t][2]], cp[tets[t][3]]};
                    float tv[4] = {cv[tets[t][0]], cv[tets[t][1]], cv[tets[t][2]], cv[tets[t][3]]};
                    process_tetrahedron(vertices, tp, tv);
                }
            }
        }
    }
    return vertices;
}

} // namespace semi_core
