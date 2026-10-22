---
name: blender-uv-bake
description: >
  Creates production UV layouts and bakes high-poly detail to low-poly maps:
  seam marking, unwrapping, texel density normalization, packing, checker QA
  and normal/AO/curvature/displacement baking. Operates through Blender-MCP.
whenToUse: >
  Use when retopology has passed, or when an asset needs unwrapping,
  UV repair, texel density normalization or texture baking.
user-invocable: true
---

# blender-uv-bake

你负责 UV 与烘焙。顺序不可跳步，checker QA 未通过不得进入正式贴图。

---

## 1. 前置条件

```text
uv:   retopology == pass
bake: uv == pass（checker QA 通过）
```

---

## 2. 强制顺序

```text
Topology QA
↓
Apply required transforms
↓
Mark seams
↓
Unwrap
↓
Normalize texel density
↓
Pack
↓
Checker QA
↓
Bake setup
↓
Bake
↓
Bake QA
```

---

## 3. 工作流细节

### 3.1 前置检查

```text
get_scene_info(query="<asset>_low",
               fields=["topology","materials","details"],
               user_prompt="<用户原话>")
```

要求：

```text
- 低模无 n-gon（或已声明允许）
- scale / rotation 已 apply
- 无重复顶点、零面积面
- 法线方向正确
- 高模与低模在同一世界坐标
```

UV / 烘焙操作全部通过 `execute_blender_code` 执行（显式进入 edit mode 后再调用
`bpy.ops.uv.*`；烘焙用 `bpy.ops.object.bake` 或节点 bake）。

### 3.2 标记接缝

```text
- 接缝放在隐藏面、硬边、材质分界
- 避免穿过高曲率与面部关键区
- 左右对称资产接缝尽量对称
- 关节处接缝避开最大变形方向
```

### 3.3 Unwrap

```text
- 优先 angle-based / conformal，按资产类型选择
- 检查拉伸：用 checker 或 stretch 显示
- 面部单独处理，避免与其他区域共享岛
- 硬表面按平面/圆柱拆分岛
```

### 3.4 Texel Density

```text
统一 texel density（像素/米）
计算公式：TD = texture_size * island_uv_area^0.5 / island_world_area^0.5
```

要求：

```text
- 同一资产内偏差 < 10%
- 面部、手部等特写区域可提高 1.5–2 倍并显式记录
- 不允许“重要区域密度更低”
```

### 3.5 Pack

```text
- padding 至少 4–8 px（按贴图尺寸与 mip 需求调整）
- 岛方向统一（主要结构沿 V 轴）
- 避免岛旋转造成法线方向混乱
- 满铺率目标：非硬表面 70%+，硬表面 60%+
```

### 3.6 Checker QA

```text
必须截图：
- UV layout
- checker texture render（多角度）
- seam 位置
检查：
- stretching / texel density / padding / island orientation / seams
```

查看方式：checker 渲染后 `look(mode="camera", shading="rendered", max_size=1024,
user_prompt="<用户原话>")`，或 `look(image="Render Result")`。
UV layout 无法用 `look` 直接取，需用 `execute_blender_code` 导出 UV 布局图。

---

## 4. 烘焙

```text
1. 确认高低模命名与配对关系
2. 设置 cage 或 ray distance
3. 按贴图集设置尺寸与采样
4. 逐图烘焙：normal / AO / curvature / displacement
5. 每张图单独检查，不合并判断
6. 失败项单独重烘，不整组重来
```

详见 `references/baking.md`。

---

## 5. 禁止

```text
- UV 未过 checker QA 就开始正式贴图
- 用高 padding 掩盖岛重叠
- 拉伸明显的区域直接烘焙
- 未 apply transform 就展开
- 多张图一次性合并判断通过与否
- 用材质修补烘焙 artifact
```

---

## 6. QA 交接

```text
uv   → QA-06：UV layout + checker render + seam
bake → QA-07：normal / AO / curvature / displacement 各自出图
```

提供：

```text
- 贴图集数量与尺寸
- texel density 报告
- 接缝清单
- 已知问题区域
```

---

## 7. 输出

```text
- UV 岛数量、满铺率、texel density
- 烘焙贴图路径与尺寸
- 失败项与原因
- next_action
```

---

## 8. References

| 文件 | 何时读取 |
|---|---|
| `references/uv-layout.md` | 接缝、展开、密度、打包 |
| `references/baking.md` | 烘焙设置与 artifact 排查 |
