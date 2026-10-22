---
name: blender-lighting-render
description: >
  Provides two distinct lighting modes: neutral QA lighting that exposes
  defects, and beauty lighting used only after production gates pass.
  Handles lookdev, cameras, render settings and final renders through
  Blender-MCP.
whenToUse: >
  Use when phase is lookdev or final_render, or when a QA render with neutral
  lighting is required.
user-invocable: true
---

# blender-lighting-render

灯光有两种职责，不能混用：

```text
QA lighting      → 暴露问题
Beauty lighting  → 表现资产
```

---

## 1. QA Lighting（几何/材质验证用）

```text
背景：neutral gray（0.18–0.5），无图案
着色：neutral matcap 或 uniform diffuse
灯光：soft key + fill（+ 可选 rim）
强度：均匀，避免高对比
相机：正交或长焦，避免透视误导比例
```

禁止：

```text
戏剧性灯光
强轮廓光掩盖边缘问题
彩色氛围光
用暗部隐藏缺陷
```

用途：

```text
blockout / primary / secondary / tertiary / retopo / UV / bake QA
```

调用方式：

```text
look(mode="angles", target=["<asset>"],
     views=["front","back","left","right","three_quarter"],
     shading="solid", max_size=768, user_prompt="<用户原话>")
```

`look` 会还原临时设置，适合反复 QA；但不会把图片写入磁盘，Gate 证据需按
`blender-expert/references/blender-mcp-contract.md` 第 5 节渲染归档。

---

## 2. Beauty Lighting（仅在 production gates 通过后）

前置：

```text
lookdev == pass
所有 production gates 通过
用户确认进入最终渲染
```

```text
允许：三点光、HDRI、轮廓光、色彩氛围、景深、后期
禁止：用 beauty lighting 作为几何/材质通过的依据
```

---

## 3. Lookdev 流程

```text
1. 确认 material == pass
2. 建立 neutral studio：key + fill + 背景
3. 渲染一版中性图
4. 切换到 HDRI / 环境光
5. 渲染第二版
6. 对比两版：材质是否都成立
7. 检查边缘高光、粗糙度层次、SSS、反射连续性
8. 输出双灯光对比图
```

HDRI 获取：

```text
search_assets(source="polyhaven", asset_type="hdris", query="<环境描述>",
              limit=5, previews=2, user_prompt="<用户原话>")
import_asset(source="polyhaven", id="<id>", asset_type="hdris",
             resolution="2k", user_prompt="<用户原话>")
```

导入 HDRI 会直接成为世界环境光；记录来源与许可。
灯光与相机对象通过 `execute_blender_code` 创建和调整。

至少两种 lighting，缺一不可。

---

## 4. 相机与渲染设置

先读取当前设置，不盲目覆盖：

```text
get_scene_info(fields=["settings"], user_prompt="<用户原话>")
```

返回 file / engine / frame range / resolution / camera / HDRI / unit scale。
修改渲染设置属于临时操作，Gate 结束后还原；不要改动用户全局偏好。

```text
相机：
- 焦距：产品/角色特写 50–85mm，全身 35–50mm（避免广角畸变）
- 正交用于比例验证
- 构图留边，避免裁切主体

渲染：
- 采样：按噪点水平调整，先低采样预览
- 降噪：确认不抹除细节
- 色彩管理：场景线性 → 显示 sRGB，保持一致
- 输出：PNG 16-bit 或 EXR（需要后期时）
```

---

## 5. Final Render 检查

```text
composition / lighting / material response / silhouette readability /
texture resolution / clipping / noise / fireflies / shadow artifacts
```

---

## 6. 禁止

```text
- 用 beauty 灯光掩盖 geometry 缺陷
- 只在单一灯光下判定材质
- 用景深模糊掩盖细节缺失
- 用后期修复本应在几何/材质阶段解决的问题
- 未通过 lookdev 就出最终图
```

---

## 7. QA 交接

```text
lookdev      → QA-08b：neutral + HDRI 对比
final_render → QA-09：最终构图 + 局部裁切
```

提供：

```text
- 灯光方案说明（key/fill/rim/HDRI）
- 相机与渲染设置
- 渲染图路径
- 已知限制
```

---

## 8. 输出

```text
- 渲染图路径
- 灯光配置摘要
- artifact 自查清单
- next_action
```

---

## 9. References

渲染 artifact 与判定标准见 `blender-qa/references/render-qa.md`。
