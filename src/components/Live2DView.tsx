import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";

interface Motion {
    name: string;
    file: string;
}

interface Expression {
    name: string;
    file: string;
}

interface ModelData {
    motions: { [key: string]: Motion[] };
    expressions: Expression[];
}

const Live2DView = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);
    const [modelData, setModelData] = useState<ModelData | null>(null);
    const [currentMotion, setCurrentMotion] = useState<string>("");
    const [currentExpression, setCurrentExpression] = useState<string>("default");
    const [showControls, setShowControls] = useState<boolean>(true);
    const [enableDragging, setEnableDragging] = useState<boolean>(true); // 默认启用拖拽
    const [isDragging, setIsDragging] = useState<boolean>(false);

    useEffect(() => {
     
       const run = async () => {
            if (!canvasRef.current) {
                console.error("❌ canvasRef is null");
                return;
            }

            (window as any).PIXI = PIXI;

            const app = new PIXI.Application({
                view: canvasRef.current,
                backgroundAlpha: 0,
                resizeTo: window,
            });

            try {
                console.log("📦 正在加载模型...");
                const model = await Live2DModel.from("/model/anon/model.json");
                modelRef.current = model;

                // 加载模型数据
                const response = await fetch("/model/anon/model.json");
                const data = await response.json();
                setModelData(data);

                model.anchor.set(0.5, 0.5);
                model.scale.set(0.3);
                model.position.set(app.screen.width / 2, app.screen.height / 2);

                app.stage.addChild(model);

                // 启用拖拽功能
                if (enableDragging) {
                    makeDraggable(model);
                }

                // 移除点击播放随机动作的功能
                // 只保留拖拽功能

                window.addEventListener("resize", () => {
                    model.position.set(app.screen.width / 2, app.screen.height / 2);
                });

                console.log("✅ 模型加载成功");
            } catch (err) {
                console.error("❌ 模型加载失败:", err);
            }
        };

        run();

        return () => {
            if (canvasRef.current) {
                const view = canvasRef.current;
                view.width = 0;
                view.height = 0;
            }
        };
    }, [enableDragging]);

    const playMotion = (motionName: string) => {
        if (modelRef.current && modelData?.motions[motionName]) {
            // 使用类似提供的代码中的方式来播放动作
            // 调用 motion 方法，传入动画索引和优先级
            modelRef.current.motion(motionName, 0, 3); // 默认动画索引和优先级
            setCurrentMotion(motionName);
            
            console.log(`🎬 播放动作: ${motionName}, 索引: 0, 优先级: 3`);
        }
    };

    const setExpression = (expressionName: string) => {
        if (modelRef.current && modelData?.expressions) {
            const expression = modelData.expressions.find(exp => exp.name === expressionName);
            if (expression) {
                // 使用类似提供的代码中的方式来设置表情
                modelRef.current.expression(expressionName);
                setCurrentExpression(expressionName);
                
                console.log(`😊 设置表情: ${expressionName}`);
            }
        }
    };

    // 拖拽立绘功能
    const makeDraggable = (model: any) => {
        model.interactive = true;
        model.buttonMode = true;
        
        model.on("pointerdown", (e: any) => {
            setIsDragging(true);
            model.dragging = true;
            model._pointerX = e.data.global.x - model.x;
            model._pointerY = e.data.global.y - model.y;
            console.log("🖱️ 开始拖拽");
        });
        
        model.on("pointermove", (e: any) => {
            if (model.dragging) {
                model.position.x = e.data.global.x - model._pointerX;
                model.position.y = e.data.global.y - model._pointerY;
            }
        });
        
        model.on("pointerup", () => {
            setIsDragging(false);
            model.dragging = false;
            console.log("✅ 拖拽结束");
        });
        
        model.on("pointerupoutside", () => {
            setIsDragging(false);
            model.dragging = false;
            console.log("✅ 拖拽结束（外部）");
        });
    };

    // 切换拖拽功能
    const toggleDragging = () => {
        if (modelRef.current) {
            if (enableDragging) {
                makeDraggable(modelRef.current);
                console.log("✅ 启用拖拽功能");
            } else {
                // 移除拖拽事件
                modelRef.current.off("pointerdown");
                modelRef.current.off("pointermove");
                modelRef.current.off("pointerup");
                modelRef.current.off("pointerupoutside");
                modelRef.current.interactive = false;
                modelRef.current.buttonMode = false;
                console.log("❌ 禁用拖拽功能");
            }
        }
    };


    return (
        <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
            <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block" }}
            />
            
            {/* 控制面板 */}
            {showControls && (
                <div style={{
                    position: "absolute",
                    top: "20px",
                    right: "20px",
                    background: "rgba(0, 0, 0, 0.8)",
                    color: "white",
                    padding: "20px",
                    borderRadius: "10px",
                    maxWidth: "300px",
                    maxHeight: "80vh",
                    overflowY: "auto",
                    fontFamily: "Arial, sans-serif"
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                        <h3 style={{ margin: 0 }}>🎭 Live2D 控制面板</h3>
                        <button
                            onClick={() => setShowControls(false)}
                            style={{
                                background: "none",
                                border: "none",
                                color: "white",
                                fontSize: "18px",
                                cursor: "pointer"
                            }}
                        >
                            ✕
                        </button>
                    </div>

                    {/* 动作选择 */}
                    <div style={{ marginBottom: "20px" }}>
                        <h4 style={{ margin: "0 0 10px 0", color: "#ffd700" }}>🎬 动作</h4>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                            {modelData && Object.keys(modelData.motions).map(motion => (
                                <button
                                    key={motion}
                                    onClick={() => playMotion(motion)}
                                    style={{
                                        background: currentMotion === motion ? "#ff6b6b" : "#4a4a4a",
                                        color: "white",
                                        border: "none",
                                        padding: "5px 8px",
                                        borderRadius: "5px",
                                        fontSize: "12px",
                                        cursor: "pointer",
                                        transition: "background 0.2s"
                                    }}
                                    title={motion}
                                >
                                    {motion}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 表情选择 */}
                    <div style={{ marginBottom: "20px" }}>
                        <h4 style={{ margin: "0 0 10px 0", color: "#ffd700" }}>😊 表情</h4>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                            {modelData && modelData.expressions.map(expression => (
                                <button
                                    key={expression.name}
                                    onClick={() => setExpression(expression.name)}
                                    style={{
                                        background: currentExpression === expression.name ? "#ff6b6b" : "#4a4a4a",
                                        color: "white",
                                        border: "none",
                                        padding: "5px 8px",
                                        borderRadius: "5px",
                                        fontSize: "12px",
                                        cursor: "pointer",
                                        transition: "background 0.2s"
                                    }}
                                    title={expression.name}
                                    >
                                    {expression.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 拖拽控制 */}
                    <div style={{ marginBottom: "20px" }}>
                        <h4 style={{ margin: "0 0 10px 0", color: "#ffd700" }}>🖱️ 拖拽控制</h4>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                                <input
                                    type="checkbox"
                                    checked={enableDragging}
                                    onChange={(e) => {
                                        setEnableDragging(e.target.checked);
                                        setTimeout(toggleDragging, 100);
                                    }}
                                    style={{ width: "16px", height: "16px" }}
                                />
                                启用拖拽移动
                            </label>
                        </div>
                        {isDragging && (
                            <div style={{ 
                                fontSize: "11px", 
                                color: "#87ceeb", 
                                marginTop: "5px",
                                fontStyle: "italic"
                            }}>
                                正在拖拽中...
                            </div>
                        )}
                    </div>

                    {/* 当前状态显示 */}
                    <div style={{ 
                        background: "rgba(255, 255, 255, 0.1)", 
                        padding: "10px", 
                        borderRadius: "5px",
                        fontSize: "12px"
                    }}>
                        <div>当前动作: <span style={{ color: "#ffd700" }}>{currentMotion || "无"}</span></div>
                        <div>当前表情: <span style={{ color: "#ffd700" }}>{currentExpression}</span></div>
                        <div>拖拽状态: <span style={{ color: "#ffd700" }}>{isDragging ? "拖拽中" : "静止"}</span></div>
                    </div>
                </div>
            )}

            {/* 显示控制面板按钮 */}
            {!showControls && (
                <button
                    onClick={() => setShowControls(true)}
                    style={{
                        position: "absolute",
                        top: "20px",
                        right: "20px",
                        background: "rgba(0, 0, 0, 0.8)",
                        color: "white",
                        border: "none",
                        padding: "10px 15px",
                        borderRadius: "5px",
                        cursor: "pointer",
                        fontSize: "14px"
                    }}
                >
                    🎛️ 显示控制面板
                </button>
            )}
        </div>
    );
};

export default Live2DView;