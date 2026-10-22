# Pipeline

本文件定义阶段、进入条件、退出条件、产出物与 Gate 失效矩阵。

---

## 1. 阶段总表

| # | Phase | Gate | Specialist | 核心产出 |
|---|---|---|---|---|
| 1 | reference | reference | blender-reference-analysis | 参考分析报告 + 比例图 |
| 2 | blockout | blockout | blender-modeling | 大体块、正确轮廓 |
| 3 | primary | primary_form | modeling / sculpt | 解剖/结构主形体 |
| 4 | secondary | secondary_form | blender-sculpt | 肌肉、骨点、面部结构、褶皱层级 |
| 5 | tertiary | tertiary_detail | blender-sculpt | 毛孔、细褶、划痕、表面破碎 |
| 6 | high_poly_qa | high_poly_qa | blender-qa | 高模多视角验证 |
| 7 | retopology | retopology | blender-retopology | 低模、UV 前的干净拓扑 |
| 8 | uv | uv | blender-uv-bake | UV 布局 + checker 验证 |
| 9 | bake | bake | blender-uv-bake | normal / AO / curvature / displacement |
| 10 | material | material | blender-material | PBR 材质 |
| 11 | lookdev | lookdev | blender-lighting-render | 中性 + HDRI 双灯光验证 |
| 12 | final_render | final_render | blender-lighting-render + blender-qa | 最终成片 |
| 13 | export | export | blender-export | 交付文件 |

---

## 2. 每个阶段的进入 / 退出条件

### 2.1 reference

```text
进入：新资产，或参考图/复刻需求出现
退出：reference gate == pass
必须产出：proportion map, silhouette, primary masses, secondary forms,
          material regions, symmetry assumptions, unknowns, confidence
禁止：任何几何创建
```

### 2.2 blockout

```text
进入：reference == pass
退出：silhouette 与 proportion 在 5~10 米距离可读且与参考一致
检查距离：去掉材质看轮廓
禁止：micro bevel、panel line、毛孔、褶皱、装饰、皮肤细节
```

### 2.3 primary

```text
进入：blockout == pass
退出：primary_form QA pass（大形体、解剖、重心、体积）
禁止：wrinkles / pores / scars / veins / skin noise / fine scales
```

### 2.4 secondary

```text
进入：primary_form == pass
退出：secondary_form QA pass
处理：muscle groups, bone landmarks, fat pads, major folds,
      facial planes, eyelids, lips, nostrils, armor transitions
```

### 2.5 tertiary

```text
进入：secondary_form == pass 且 Detail Lock 未触发
退出：high-poly 完成，surface detail 一致且无噪点
处理：pores, micro wrinkles, fine scales, scratches, tiny folds, engraving
```

### 2.6 high_poly_qa

```text
进入：tertiary 完成
退出：8 视角 turntable + 细节特写通过
不通过则回到 tertiary 或 secondary，不进入 retopology
```

### 2.7 retopology

```text
进入：high_poly_qa == pass 且 major shape changes unlikely
退出：edge flow / pole / density / deformation loops 全部通过
进入后默认 HIGH POLY SHAPE FREEZE
```

### 2.8 uv

```text
进入：retopology == pass
退出：checker QA 通过（无拉伸、texel density 一致、padding 足够）
禁止：UV 未过 checker QA 就做正式贴图
```

### 2.9 bake

```text
进入：uv == pass
退出：normal / AO / curvature / displacement 各自通过
检查：cage、projection、seam、skew、hard edge
```

### 2.10 material

```text
进入：bake == pass，或资产声明使用 procedural/triplanar 流程
退出：lookdev 前的材质层级完整（macro → breakup → meso → micro）
```

### 2.11 lookdev

```text
进入：material == pass
退出：中性棚灯 + HDRI 两套灯光下表现一致，无“只在一套灯光下正确”
```

### 2.12 final_render

```text
进入：lookdev == pass
退出：构图、灯光、材质响应、轮廓可读、无噪点/萤火虫/穿帮
```

### 2.13 export

```text
进入：final_render == pass
退出：命名、变换、单位、材质引用、贴图路径、面数预算全部通过
```

---

## 3. Gate 依赖图

```text
reference
   └─> blockout
         └─> primary_form
               └─> secondary_form
                     └─> tertiary_detail
                           └─> high_poly_qa
                                 └─> retopology
                                       └─> uv
                                             └─> bake
                                                   └─> material
                                                         └─> lookdev
                                                               └─> final_render
                                                                     └─> export
```

依赖边即失效传播边：上游被修改，下游全部按矩阵处理。

---

## 4. Gate 失效矩阵

行 = 发生变化的对象，列 = 受影响的下游 gate。

| 变更类型 | retopo | uv | bake | material | lookdev | render | export |
|---|---|---|---|---|---|---|---|
| 高模形状改变（silhouette/比例/体块） | invalid | invalid | invalid | invalid | invalid | invalid | invalid |
| 高模表面细节改变（仅 tertiary） | invalid | — | invalid | invalid | invalid | invalid | invalid |
| 低模拓扑改变 | — | invalid | invalid | invalid | invalid | invalid | invalid |
| UV 岛结构改变 | — | — | invalid | invalid | invalid | invalid | invalid |
| 仅烘焙参数改变 | — | — | pending | potentially_stale | potentially_stale | invalid | invalid |
| 仅材质参数改变 | — | — | — | — | pending | invalid | invalid |
| 仅灯光改变 | — | — | — | — | — | pending | invalid |
| 导出设置改变 | — | — | — | — | — | — | pending |

处理规则：

```text
invalid            → 必须重做并重新 QA
pending            → 需重新验证，但可能一次通过
potentially_stale  → 立即目视复核，记录复核结果
—                  → 不受影响
```

---

## 5. 回退规则

```text
QA fail
→ 回到产生缺陷的阶段
→ 修复
→ 重新 QA
→ 禁止“先继续后面再说”
```

跨阶段回退时：

```text
1. 将回退目标之上的所有已通过 gate 置为 invalid
2. 保留 checkpoint，不删除
3. 预算按第 8 节重置规则处理
4. 重新进入目标阶段时重新加载对应 specialist
```

---

## 6. Checkpoint 映射

| Gate 通过 | Checkpoint |
|---|---|
| reference | `00_reference.blend` |
| blockout | `01_blockout_pass.blend` |
| primary_form | `02_primary_pass.blend` |
| secondary_form | `03_secondary_pass.blend` |
| tertiary_detail + high_poly_qa | `04_highpoly_final.blend` |
| retopology | `05_retopology.blend` |
| uv | `06_uv.blend` |
| bake | `07_bake.blend` |
| material | `08_material.blend` |
| final_render | `09_final.blend` |
| export | 交付包目录 |

checkpoint 只在 pass 后写入，失败状态不写。
