# Visual QA

形体、比例、轮廓的判定方法。

---

## 1. 标准视角

```text
front / back / left / right / three_quarter_front / three_quarter_back
角色追加：orthographic front / orthographic side
高模终检：8 视角 turntable
```

固定视角、固定构图、固定灯光，便于逐轮对比。

---

## 2. 与参考比对

### 2.1 轮廓叠加

```text
1. 将渲染图与参考图对齐到同一主尺度（如身高）
2. 叠加半透明层
3. 标出超出参考的凸起与缺失的凹陷
4. 测量偏差百分比
```

判定：

```text
偏差 ≤ 3%   可接受
3–6%        medium
> 6%        high
关键部位（眼、口、关节）> 2% 即 high
```

### 2.2 镜像翻转检查

```text
把渲染图水平翻转，再与原图并排看
目的：暴露左右不对称、头身比失衡
```

### 2.3 剪影填充检查

```text
把渲染图转成纯黑剪影
检查：
- 形体是否可识别
- 负空间形状是否正确
- 关键转折点是否缺失
```

### 2.4 地标测量

```text
用比例表的关键坐标，在渲染图上量取
记录每项的偏差
偏差项直接对应到 blocking 或 non_blocking
```

---

## 3. 距离可读性

```text
5–10 米等效视觉距离：
- 缩小渲染图到 10–20% 尺寸
- 检查主轮廓是否仍正确
- 此时不可读的结构 = blocking
```

---

## 4. 各 Gate 关注点

### Blockout

```text
silhouette / proportions / mass distribution / symmetry / reference match
```

### Primary

```text
large planes / anatomy / weight / volume
```

### Secondary

```text
facial structure / muscle transitions / bone landmarks /
fold hierarchy / form readability
```

### Tertiary / High Poly

```text
detail scale / consistency / over-noising / pinching /
sculpt artifacts / surface rhythm
```

---

## 5. 常见误判

```text
- 透视畸变被当成比例错误（确认焦距与相机距离）
- 灯光方向造成“形体歪斜”的错觉
- 材质高光掩盖平面转折
- 只看 3/4 视角，忽略正交视图
- 把风格化比例当成错误
- 用局部特写放行整体轮廓问题
```

规则：

```text
先看整体轮廓，再看局部结构
先用正交图判定比例，再用透视图判定观感
```

---

## 6. 分数锚点

```text
0.95–1.00  几乎无法与参考区分
0.90–0.95  非专业观察者难以指出差异
0.85–0.90  专业人士能指出 1–2 处小偏差
0.70–0.85  明显偏差，影响轮廓/比例
< 0.70     结构性错误
```

分数只用于趋势；同一 gate 必须沿用相同视角与灯光才可比较。

---

## 7. 输出要点

```text
- 每项 blocking 必须带 region、issue、severity、evidence
- issue 必须可执行（指明方向与幅度）
- 不给“感觉不对”这类结论
- non_blocking 单独列出，不阻塞流程
```
