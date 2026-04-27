// ── Three.js 场景核心 / Three.js scene core ──
let scene, camera, renderer, raycaster;

// ── 牌库与场景中的牌 / Deck pool & active cards ──
let deckPool = [...Array(78).keys()];
let activeCards = [];
let particles = [];

// ── 手势状态 / Gesture state ──
let currentGesture = "NONE";
let handScreenPos = new THREE.Vector2();
let isGestureReady = false;
let activeInputMode = null;

// ── 牌阵状态机 / Spread state machine ──
// 'IDLE'    : 待机——展示层叠扇御圆
// 'ACTIVE'  : 当前牌阵进行中
// 'AWAITING': 全部确认，等待下一阵指令
// 'ENDED'   : 用户拒绝继续
// Additional state: 'ENTERING' means OPEN has locked and the spread is being dealt.
let spreadState = 'IDLE';
let confirmedInSpread = 0;   // 本阵已确认牌数
let spreadCards = 3;         // 本阵需确认总数（idle pinch 可变）
let spreadCount = 0;         // 已完成牌阵数
let gestureDebounce = 0;     // 防止手势被连续触发

// ── 待机轮播状态 / Idle carousel state ──
let idleCards = [];
let fanAngle = 0;
let isIdleRotating = true;        // 轮盘是否自转 / Carousel auto-rotating
let idlePointedCard = null;       // 当前被食指指向的轮盘牌 / Currently pointed card in idle
let idlePinchedCards = [];        // 在待机时被pinch查看过的牌 / Cards pinched in idle
let idleHeldCard = null;          // 当前被捏住悬空的轮盘牌 / Card currently held (pinched) in idle

// ── 轮播旋转速度 / Carousel rotation velocity ──
const CAROUSEL_BASE_SPEED = -0.001;  // 默认向左自转（负=逆时针俯视）
let carouselVelocity = CAROUSEL_BASE_SPEED;
let twoFingerPrevX = null;            // 上一帧双指X坐标，用于计算滑动速度
