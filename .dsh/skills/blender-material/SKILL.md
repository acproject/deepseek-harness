---
name: blender-material
description: >
  Authors physically layered PBR materials: macro variation, material
  breakup, mesoscopic detail and micro detail. Covers skin, metal, fabric,
  plastic and generic surfaces. Operates through Blender-MCP.
whenToUse: >
  Use when phase is material and either UV and bake have passed, or the asset
  explicitly uses a procedural/triplanar workflow.
user-invocable: true
---

# blender-material

你负责材质，不负责几何。材质不能用来掩盖形体或烘焙缺陷。

---

## 1. 前置条件

```text
(uv == pass AND bake == pass)
OR
asset 明确声明 procedural / triplanar workflow（记录于 state）
```

不满足则退回 uv-bake。禁止用材质修补几何/烘焙问题。

---

## 2. 物理层级

必须自下而上建立，不允许直接堆噪波：

```text
Macro variation      大尺度颜色/粗糙度变化（几十厘米级）
↓
Material breakup     材质分区、边缘磨损、沉积
↓
Mesoscopic detail    中等尺度纹理（μm–mm 级）
↓
Micro detail         微观法线、颗粒、毛孔
```

每层只承担一个频率范围，避免“双倍细节”。

---

## 3. 工作流

```text
1. 读取材质分区（来自 reference-analysis）
2. 为每个分区建立独立材质槽，命名 <asset>_<part>_mat
3. 先定基础参数（base color / metallic / roughness），不加纹理
4. 中性灯光下检查能量与明度关系
5. 按层级加入变化
6. 双灯光验证（neutral studio + HDRI）
7. 检查贴图色彩空间与法线方向
```

调用方式：

```text
get_scene_info(fields=["materials","modifiers","details"], user_prompt="<用户原话>")
execute_blender_code(...)         # 用节点树直接构建材质，不靠 UI
look(mode="camera", shading="material", max_size=1024, user_prompt="<用户原话>")
```

需要现成 PBR 贴图时：

```text
search_assets(source="polyhaven", asset_type="textures", query="<材质描述>",
              resolution="2k", user_prompt="<用户原话>")
import_asset(source="polyhaven", id="<id>", asset_type="textures",
             apply_to=["<object>"], resolution="2k", user_prompt="<用户原话>")
```

导入后必须记录来源与许可；不得用导入材质替代本该手工设计的材质分区。

---

## 4. 参数参考

```text
Base color   非金属：0.04–0.9 线性值；避免纯黑（0）与纯白（1）
Metallic     0 或 1，中间值仅用于过渡/污渍
Roughness    0.02–1.0；常见表面 0.25–0.7
IOR          非金属 1.4–1.6，皮肤 1.4，玻璃 1.5
Normal       强度按贴图与尺度，避免 > 1.5 的过度设置
```

规则：

```text
- 能量守恒：base color + specular 不应超过物理合理范围
- 金属的 base color 是反射色，不是漫反射色
- 粗糙度变化比颜色变化更影响真实感
```

---

## 5. 贴图规范

```text
Base color / emission   sRGB
Normal / roughness / metallic / AO / displacement   Non-Color
分辨率与 texel density 匹配（不盲目 4K）
贴图命名：<asset>_<part>_<map>_<size>.png
```

---

## 6. 禁止

```text
- 直接堆叠多层 Noise/Voronoi 冒充材质
- 用材质亮度掩盖形体缺陷
- 在单一布光下判定材质正确
- 使用未统一色彩空间的贴图
- 金属材质用低粗糙度掩盖缺少细节
- 皮肤用纯 SSS 常量替代分层结构
```

---

## 7. QA 交接

```text
material → QA-08：neutral studio + HDRI，至少两套灯光
lookdev  → QA-08b
```

提供：

```text
- 材质槽清单与用途
- 贴图清单（色彩空间、尺寸）
- 已知限制（如缺少某张贴图）
```

---

## 8. 输出

```text
- 材质命名与分配
- 贴图路径
- 双灯光渲染截图
- next_action
```

---

## 9. References

| 文件 | 何时读取 |
|---|---|
| `references/pbr.md` | 通用 PBR 参数与工作流 |
| `references/skin.md` | 皮肤/生物表面 |
| `references/metal.md` | 金属与硬表面 |
| `references/fabric.md` | 布料/皮革/毛发基底 |
