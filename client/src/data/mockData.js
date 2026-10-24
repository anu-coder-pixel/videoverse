/**
 * VideoVerse — Central Video & Application Dataset
 *
 * Contains 65+ curated videos across 15 categories and 15 creator channels.
 * Every video features:
 * - Legitimate, verified photographic thumbnails from Unsplash
 * - Real playable HTML5 video streams with fallback handling
 * - Rich metadata, view counts, upload dates, and category tags
 */

export const CATEGORIES = [
  'All',
  'Trending',
  'Technology',
  'Gaming',
  'Music',
  'Education',
  'Travel',
  'Science',
  'Cooking',
  'Sports',
  'Animation',
  'Documentary',
  'Comedy',
  'News',
  'Fitness',
];

export const MOCK_CHANNELS = [
  {
    "id": "ch-001",
    "name": "CodeCraft Studio",
    "handle": "@codecraft",
    "subscribers": "1.2M",
    "avatarColor": "#6c63ff",
    "initials": "CC",
    "verified": true
  },
  {
    "id": "ch-002",
    "name": "NovaNomad",
    "handle": "@novanomad",
    "subscribers": "845K",
    "avatarColor": "#ff6584",
    "initials": "NN",
    "verified": true
  },
  {
    "id": "ch-003",
    "name": "QuantumQuest",
    "handle": "@quantumquest",
    "subscribers": "2.1M",
    "avatarColor": "#43e97b",
    "initials": "QQ",
    "verified": true
  },
  {
    "id": "ch-004",
    "name": "MindfulMelodies",
    "handle": "@mindfulmelodies",
    "subscribers": "390K",
    "avatarColor": "#f9a825",
    "initials": "MM",
    "verified": false
  },
  {
    "id": "ch-005",
    "name": "Techverse Daily",
    "handle": "@techversedaily",
    "subscribers": "3.5M",
    "avatarColor": "#40c4ff",
    "initials": "TD",
    "verified": true
  },
  {
    "id": "ch-006",
    "name": "GlobeTrekker",
    "handle": "@globetrekker",
    "subscribers": "620K",
    "avatarColor": "#ff9800",
    "initials": "GT",
    "verified": false
  },
  {
    "id": "ch-007",
    "name": "PixelForge Games",
    "handle": "@pixelforge",
    "subscribers": "1.8M",
    "avatarColor": "#e91e63",
    "initials": "PF",
    "verified": true
  },
  {
    "id": "ch-008",
    "name": "CulinaryCanvas",
    "handle": "@culinarycanvas",
    "subscribers": "930K",
    "avatarColor": "#ff5722",
    "initials": "CC",
    "verified": true
  },
  {
    "id": "ch-009",
    "name": "BioSphere Earth",
    "handle": "@biosphere",
    "subscribers": "1.4M",
    "avatarColor": "#8bc34a",
    "initials": "BE",
    "verified": true
  },
  {
    "id": "ch-010",
    "name": "IronPulse Fitness",
    "handle": "@ironpulse",
    "subscribers": "710K",
    "avatarColor": "#00bcd4",
    "initials": "IP",
    "verified": false
  },
  {
    "id": "ch-011",
    "name": "NeonToons Studio",
    "handle": "@neontoons",
    "subscribers": "1.1M",
    "avatarColor": "#9c27b0",
    "initials": "NT",
    "verified": true
  },
  {
    "id": "ch-012",
    "name": "StandUp Central",
    "handle": "@standupcentral",
    "subscribers": "2.8M",
    "avatarColor": "#ffc107",
    "initials": "SC",
    "verified": true
  },
  {
    "id": "ch-013",
    "name": "Apex Athletics",
    "handle": "@apexathletics",
    "subscribers": "1.6M",
    "avatarColor": "#00e676",
    "initials": "AA",
    "verified": true
  },
  {
    "id": "ch-014",
    "name": "GlobalChronicle",
    "handle": "@globalchronicle",
    "subscribers": "3.1M",
    "avatarColor": "#3f51b5",
    "initials": "GC",
    "verified": true
  },
  {
    "id": "ch-015",
    "name": "EduPulse Academy",
    "handle": "@edupulse",
    "subscribers": "890K",
    "avatarColor": "#009688",
    "initials": "EA",
    "verified": false
  }
];

export const THUMB_PALETTES = [
  ['#6c63ff', '#a78bfa'],
  ['#ff6584', '#ff9f68'],
  ['#43e97b', '#38f9d7'],
  ['#4facfe', '#00f2fe'],
  ['#fa709a', '#fee140'],
  ['#a18cd1', '#fbc2eb'],
  ['#ffecd2', '#fcb69f'],
  ['#667eea', '#764ba2'],
  ['#11998e', '#38ef7d'],
  ['#fc5c7d', '#6a3093'],
  ['#3f2b96', '#a8c0ff'],
  ['#c94b4b', '#4b134f'],
];

export function getThumbnailStyle(index) {
  const palette = THUMB_PALETTES[(index || 0) % THUMB_PALETTES.length];
  return {
    background: `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)`,
  };
}

export const MOCK_VIDEOS = [
  {
    "id": "vid-001",
    "title": "Building a Full-Stack App with React & Node.js in 2026",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "1.4M",
    "uploadedAt": "3 days ago",
    "duration": "42:15",
    "likes": "48K",
    "description": "In this comprehensive tutorial, we build a production-ready full-stack application from scratch using React 19, Node.js, Express, and PostgreSQL. We cover authentication, REST APIs, deployment, and more.",
    "tags": [
      "React",
      "Node.js",
      "Full-Stack",
      "Tutorial",
      "JavaScript"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 0,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-002",
    "title": "AI is Changing the World — Complete 2026 Landscape",
    "channel": {
      "id": "ch-005",
      "name": "Techverse Daily",
      "handle": "@techversedaily",
      "subscribers": "3.5M",
      "avatarColor": "#40c4ff",
      "initials": "TD",
      "verified": true
    },
    "category": "Technology",
    "views": "5.7M",
    "uploadedAt": "1 day ago",
    "duration": "24:10",
    "likes": "201K",
    "description": "From multimodal foundation models to autonomous coding agents, artificial intelligence is rewriting the software industry. We examine recent milestones and ethical frontiers.",
    "tags": [
      "AI",
      "Machine Learning",
      "Future",
      "Technology"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 1,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-003",
    "title": "TypeScript Deep Dive — Generics, Utility Types & Design Patterns",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "765K",
    "uploadedAt": "10 days ago",
    "duration": "55:08",
    "likes": "29K",
    "description": "Master TypeScript with this deep dive into advanced types, conditional types, mapped types, template literal types, and enterprise architecture patterns.",
    "tags": [
      "TypeScript",
      "JavaScript",
      "Programming",
      "Architecture"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 2,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-004",
    "title": "React 19 New Features — Compiler, Actions & Server Components",
    "channel": {
      "id": "ch-005",
      "name": "Techverse Daily",
      "handle": "@techversedaily",
      "subscribers": "3.5M",
      "avatarColor": "#40c4ff",
      "initials": "TD",
      "verified": true
    },
    "category": "Technology",
    "views": "2.9M",
    "uploadedAt": "4 days ago",
    "duration": "38:55",
    "likes": "98K",
    "description": "React 19 eliminates manual memoization with the React Compiler and introduces Actions, useActionState, useOptimistic, and direct asset loading.",
    "tags": [
      "React",
      "Frontend",
      "Web Development",
      "JavaScript"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 3,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-005",
    "title": "Docker & Kubernetes Crash Course for Modern Developers",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "1.1M",
    "uploadedAt": "2 weeks ago",
    "duration": "1:14:20",
    "likes": "45K",
    "description": "Everything you need to know about containerizing applications, writing Dockerfiles, managing multi-container stacks with Docker Compose, and deploying to Kubernetes clusters.",
    "tags": [
      "DevOps",
      "Docker",
      "Kubernetes",
      "Cloud"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 4,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-006",
    "title": "Python for Beginners — Learn Python in 60 Minutes",
    "channel": {
      "id": "ch-015",
      "name": "EduPulse Academy",
      "handle": "@edupulse",
      "subscribers": "890K",
      "avatarColor": "#009688",
      "initials": "EA",
      "verified": false
    },
    "category": "Technology",
    "views": "3.4M",
    "uploadedAt": "3 weeks ago",
    "duration": "59:45",
    "likes": "142K",
    "description": "A friendly step-by-step introduction to Python programming syntax, control flow, functions, object-oriented concepts, and data structures with real coding exercises.",
    "tags": [
      "Python",
      "Programming",
      "Beginner",
      "Tutorial"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 5,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-007",
    "title": "Next.js 15 Full Course — App Router, Server Actions & Caching",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "890K",
    "uploadedAt": "1 week ago",
    "duration": "1:45:10",
    "likes": "37K",
    "description": "Build modern server-rendered web applications with Next.js 15. Covers Turbopack, dynamic IO, asynchronous request APIs, and production deployment on Vercel.",
    "tags": [
      "Next.js",
      "React",
      "Full-Stack",
      "Web Development"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 6,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-008",
    "title": "Cybersecurity Fundamentals — How Hackers Attack and How to Defend",
    "channel": {
      "id": "ch-005",
      "name": "Techverse Daily",
      "handle": "@techversedaily",
      "subscribers": "3.5M",
      "avatarColor": "#40c4ff",
      "initials": "TD",
      "verified": true
    },
    "category": "Technology",
    "views": "2.1M",
    "uploadedAt": "3 weeks ago",
    "duration": "31:50",
    "likes": "88K",
    "description": "An eye-opening breakdown of common cyber threats: SQL injection, cross-site scripting (XSS), phishing, ransomware, and the cryptographic mechanisms protecting modern networks.",
    "tags": [
      "Cybersecurity",
      "Security",
      "Hacking",
      "Technology"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 7,
    "videoUrl": "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-009",
    "title": "Why Rust is the Future of Systems Programming",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "620K",
    "uploadedAt": "5 days ago",
    "duration": "22:15",
    "likes": "31K",
    "description": "Explore the Rust programming language: borrow checker, memory safety without garbage collection, zero-cost abstractions, and fearless concurrency.",
    "tags": [
      "Rust",
      "Systems",
      "Programming",
      "Performance"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 8,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-010",
    "title": "Computer Vision in Practice — Object Detection with YOLO",
    "channel": {
      "id": "ch-005",
      "name": "Techverse Daily",
      "handle": "@techversedaily",
      "subscribers": "3.5M",
      "avatarColor": "#40c4ff",
      "initials": "TD",
      "verified": true
    },
    "category": "Technology",
    "views": "480K",
    "uploadedAt": "2 weeks ago",
    "duration": "27:40",
    "likes": "19K",
    "description": "Implement real-time object detection using OpenCV and PyTorch. Learn how convolutional neural networks classify and localize objects in live camera streams.",
    "tags": [
      "AI",
      "Computer Vision",
      "PyTorch",
      "Python"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 9,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-011",
    "title": "Cloud Architecture Explained — AWS vs Google Cloud vs Azure",
    "channel": {
      "id": "ch-005",
      "name": "Techverse Daily",
      "handle": "@techversedaily",
      "subscribers": "3.5M",
      "avatarColor": "#40c4ff",
      "initials": "TD",
      "verified": true
    },
    "category": "Technology",
    "views": "1.3M",
    "uploadedAt": "1 month ago",
    "duration": "36:20",
    "likes": "52K",
    "description": "Comparing compute, serverless, storage, and networking across Amazon Web Services, GCP, and Microsoft Azure. Find the right cloud provider for your tech stack.",
    "tags": [
      "Cloud",
      "AWS",
      "Azure",
      "DevOps"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 10,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-012",
    "title": "Building Real-Time Apps with WebSockets and Node.js",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "540K",
    "uploadedAt": "2 weeks ago",
    "duration": "29:10",
    "likes": "23K",
    "description": "Step-by-step guide to bidirectional event-driven communication using Socket.io and native WebSockets. Build a collaborative live chat and multiplayer room system.",
    "tags": [
      "WebSockets",
      "Node.js",
      "Realtime",
      "JavaScript"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 11,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "fallbackUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4"
  },
  {
    "id": "vid-013",
    "title": "Microservices vs Monolith — An Honest Engineering Guide",
    "channel": {
      "id": "ch-001",
      "name": "CodeCraft Studio",
      "handle": "@codecraft",
      "subscribers": "1.2M",
      "avatarColor": "#6c63ff",
      "initials": "CC",
      "verified": true
    },
    "category": "Technology",
    "views": "970K",
    "uploadedAt": "3 weeks ago",
    "duration": "26:45",
    "likes": "41K",
    "description": "When does a distributed microservices architecture actually pay off, and when does it introduce needless operational complexity? Real architectural case studies.",
    "tags": [
      "Architecture",
      "Software Engineering",
      "Microservices",
      "Backend"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 0,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-014",
    "title": "Top 10 Open World RPGs You Must Experience in 2026",
    "channel": {
      "id": "ch-007",
      "name": "PixelForge Games",
      "handle": "@pixelforge",
      "subscribers": "1.8M",
      "avatarColor": "#e91e63",
      "initials": "PF",
      "verified": true
    },
    "category": "Gaming",
    "views": "2.4M",
    "uploadedAt": "4 days ago",
    "duration": "21:35",
    "likes": "96K",
    "description": "From sprawling fantasy continents to cyberpunk metropolises, we review the absolute best open-world role-playing games that deliver hundreds of hours of immersive discovery.",
    "tags": [
      "Gaming",
      "RPG",
      "Open World",
      "Review"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 1,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-015",
    "title": "Unreal Engine 5.5 Next-Gen Graphics Demo Breakdown",
    "channel": {
      "id": "ch-007",
      "name": "PixelForge Games",
      "handle": "@pixelforge",
      "subscribers": "1.8M",
      "avatarColor": "#e91e63",
      "initials": "PF",
      "verified": true
    },
    "category": "Gaming",
    "views": "1.7M",
    "uploadedAt": "1 week ago",
    "duration": "18:50",
    "likes": "74K",
    "description": "Examining Nanite tessellation, Lumen real-time global illumination, and procedural content generation in Unreal Engine 5.5. What photorealism means for the future of interactive worlds.",
    "tags": [
      "Unreal Engine",
      "Gaming",
      "Game Dev",
      "3D Graphics"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 2,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-016",
    "title": "Competitive Esports Championship — Insane Finals Highlights",
    "channel": {
      "id": "ch-007",
      "name": "PixelForge Games",
      "handle": "@pixelforge",
      "subscribers": "1.8M",
      "avatarColor": "#e91e63",
      "initials": "PF",
      "verified": true
    },
    "category": "Gaming",
    "views": "3.1M",
    "uploadedAt": "5 days ago",
    "duration": "28:12",
    "likes": "135K",
    "description": "The most electrifying tactical plays, clutch moments, and round comebacks from the world finals tournament. Commentary and tactical play-by-play analysis.",
    "tags": [
      "Esports",
      "Gaming",
      "Highlights",
      "Tournament"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 3,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4"
  },
  {
    "id": "vid-017",
    "title": "Retro Gaming History — The Golden Age of Arcade Machines",
    "channel": {
      "id": "ch-007",
      "name": "PixelForge Games",
      "handle": "@pixelforge",
      "subscribers": "1.8M",
      "avatarColor": "#e91e63",
      "initials": "PF",
      "verified": true
    },
    "category": "Gaming",
    "views": "820K",
    "uploadedAt": "2 weeks ago",
    "duration": "34:25",
    "likes": "39K",
    "description": "Travel back to the 1980s and 90s to discover the engineering wizardry, pixel art masters, and cultural explosion that launched the global video games industry.",
    "tags": [
      "Retro",
      "Arcade",
      "Gaming History",
      "Nostalgia"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 4,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  },
  {
    "id": "vid-018",
    "title": "Indie Games That Deserve More Love in 2026",
    "channel": {
      "id": "ch-007",
      "name": "PixelForge Games",
      "handle": "@pixelforge",
      "subscribers": "1.8M",
      "avatarColor": "#e91e63",
      "initials": "PF",
      "verified": true
    },
    "category": "Gaming",
    "views": "590K",
    "uploadedAt": "6 days ago",
    "duration": "16:40",
    "likes": "28K",
    "description": "Uncovering five hidden indie gems with unique storytelling, hand-crafted art styles, and inventive gameplay mechanics created by passionate solo developers.",
    "tags": [
      "Indie Games",
      "Gaming",
      "Reviews",
      "Recommendations"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1560253023-3ec5d502959f?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 5,
    "videoUrl": "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-019",
    "title": "Lo-Fi Hip Hop Beats — Study & Chill Mix 2026",
    "channel": {
      "id": "ch-004",
      "name": "MindfulMelodies",
      "handle": "@mindfulmelodies",
      "subscribers": "390K",
      "avatarColor": "#f9a825",
      "initials": "MM",
      "verified": false
    },
    "category": "Music",
    "views": "4.1M",
    "uploadedAt": "5 days ago",
    "duration": "2:01:33",
    "likes": "120K",
    "description": "The perfect study companion. 2 hours of carefully curated lo-fi beats, warm vinyl crackle, and soothing melodies to help you focus, code, and stay in the zone.",
    "tags": [
      "LoFi",
      "Music",
      "Study",
      "Chill",
      "Beats"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 6,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  },
  {
    "id": "vid-020",
    "title": "Acoustic Guitar Sessions — Peaceful Fingerstyle Melodies",
    "channel": {
      "id": "ch-004",
      "name": "MindfulMelodies",
      "handle": "@mindfulmelodies",
      "subscribers": "390K",
      "avatarColor": "#f9a825",
      "initials": "MM",
      "verified": false
    },
    "category": "Music",
    "views": "1.2M",
    "uploadedAt": "2 weeks ago",
    "duration": "45:10",
    "likes": "55K",
    "description": "Original acoustic guitar compositions performed in a warm studio space. Soothing fingerpicking music designed for deep relaxation and creative work.",
    "tags": [
      "Acoustic",
      "Guitar",
      "Instrumental",
      "Relaxing"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 7,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-021",
    "title": "Synthwave Night Drive — Retro Electro Chillout",
    "channel": {
      "id": "ch-004",
      "name": "MindfulMelodies",
      "handle": "@mindfulmelodies",
      "subscribers": "390K",
      "avatarColor": "#f9a825",
      "initials": "MM",
      "verified": false
    },
    "category": "Music",
    "views": "2.8M",
    "uploadedAt": "1 week ago",
    "duration": "1:15:00",
    "likes": "94K",
    "description": "Cruising neon-soaked highways under midnight skies. Atmospheric synthwave, outrun basslines, and retrofuturistic analog synthesizers.",
    "tags": [
      "Synthwave",
      "Electronic",
      "Retro",
      "Night Drive"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 8,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-022",
    "title": "Classical Piano Masterpieces for Deep Work & Concentration",
    "channel": {
      "id": "ch-004",
      "name": "MindfulMelodies",
      "handle": "@mindfulmelodies",
      "subscribers": "390K",
      "avatarColor": "#f9a825",
      "initials": "MM",
      "verified": false
    },
    "category": "Music",
    "views": "3.6M",
    "uploadedAt": "1 month ago",
    "duration": "1:40:20",
    "likes": "140K",
    "description": "Chopin, Debussy, Satie, and contemporary neoclassical piano pieces recorded on a Steinway grand piano for maximum acoustic warmth and clarity.",
    "tags": [
      "Classical",
      "Piano",
      "Concentration",
      "Deep Work"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1552422535-c45813c61732?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 9,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-023",
    "title": "Live Electronic Music Festival Set — Sunset Sessions",
    "channel": {
      "id": "ch-004",
      "name": "MindfulMelodies",
      "handle": "@mindfulmelodies",
      "subscribers": "390K",
      "avatarColor": "#f9a825",
      "initials": "MM",
      "verified": false
    },
    "category": "Music",
    "views": "1.9M",
    "uploadedAt": "3 weeks ago",
    "duration": "52:45",
    "likes": "68K",
    "description": "Experience the electric festival atmosphere with this melodic house and progressive techno DJ set recorded live overlooking the Mediterranean coastline.",
    "tags": [
      "EDM",
      "Festival",
      "Live Music",
      "House"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 10,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-024",
    "title": "Beginner's Guide to Astrophotography — Photograph the Milky Way",
    "channel": {
      "id": "ch-003",
      "name": "QuantumQuest",
      "handle": "@quantumquest",
      "subscribers": "2.1M",
      "avatarColor": "#43e97b",
      "initials": "QQ",
      "verified": true
    },
    "category": "Education",
    "views": "430K",
    "uploadedAt": "2 months ago",
    "duration": "31:17",
    "likes": "18K",
    "description": "You don't need a multi-thousand-dollar observatory telescope to photograph celestial wonders. Learn camera settings, dark-sky planning, and image stacking software.",
    "tags": [
      "Photography",
      "Astronomy",
      "Education",
      "Tutorial"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 11,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-025",
    "title": "The Essence of Calculus — Visualizing Derivatives & Integrals",
    "channel": {
      "id": "ch-015",
      "name": "EduPulse Academy",
      "handle": "@edupulse",
      "subscribers": "890K",
      "avatarColor": "#009688",
      "initials": "EA",
      "verified": false
    },
    "category": "Education",
    "views": "2.7M",
    "uploadedAt": "3 weeks ago",
    "duration": "25:40",
    "likes": "115K",
    "description": "Discover how Isaac Newton and Gottfried Leibniz visualized rates of change and cumulative areas under curves. Beautiful geometric animations explain core concepts.",
    "tags": [
      "Mathematics",
      "Calculus",
      "Education",
      "Science"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 0,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-026",
    "title": "Ancient Civilizations — The Engineering of the Great Pyramids",
    "channel": {
      "id": "ch-015",
      "name": "EduPulse Academy",
      "handle": "@edupulse",
      "subscribers": "890K",
      "avatarColor": "#009688",
      "initials": "EA",
      "verified": false
    },
    "category": "Education",
    "views": "1.8M",
    "uploadedAt": "1 month ago",
    "duration": "44:30",
    "likes": "72K",
    "description": "Investigating ancient quarrying techniques, astronomical alignment, ramp mechanics, and modern archaeological LiDAR scanning of Giza plateau monuments.",
    "tags": [
      "History",
      "Archaeology",
      "Ancient Egypt",
      "Education"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 1,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-027",
    "title": "Public Speaking Masterclass — How to Speak So People Listen",
    "channel": {
      "id": "ch-015",
      "name": "EduPulse Academy",
      "handle": "@edupulse",
      "subscribers": "890K",
      "avatarColor": "#009688",
      "initials": "EA",
      "verified": false
    },
    "category": "Education",
    "views": "940K",
    "uploadedAt": "2 weeks ago",
    "duration": "28:15",
    "likes": "46K",
    "description": "Learn vocal variety, pause pacing, body language, audience engagement techniques, and storytelling frameworks used by the most influential conference speakers.",
    "tags": [
      "Communication",
      "Public Speaking",
      "Productivity",
      "Self Improvement"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 2,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-028",
    "title": "How Memory Works — Evidence-Based Learning Techniques",
    "channel": {
      "id": "ch-015",
      "name": "EduPulse Academy",
      "handle": "@edupulse",
      "subscribers": "890K",
      "avatarColor": "#009688",
      "initials": "EA",
      "verified": false
    },
    "category": "Education",
    "views": "1.5M",
    "uploadedAt": "3 weeks ago",
    "duration": "22:50",
    "likes": "63K",
    "description": "Spaced repetition, active recall, dual coding, and the neuroscience of long-term memory consolidation. Transform the way you retain complex subjects.",
    "tags": [
      "Neuroscience",
      "Study Tips",
      "Learning",
      "Productivity"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 3,
    "videoUrl": "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-029",
    "title": "Hidden Gems of Ladakh — A Solo Travel Diary",
    "channel": {
      "id": "ch-002",
      "name": "NovaNomad",
      "handle": "@novanomad",
      "subscribers": "845K",
      "avatarColor": "#ff6584",
      "initials": "NN",
      "verified": true
    },
    "category": "Travel",
    "views": "892K",
    "uploadedAt": "1 week ago",
    "duration": "28:40",
    "likes": "32K",
    "description": "Join me on an unforgettable journey through the breathtaking landscapes of Ladakh. From frozen high-altitude passes to ancient cliffside monasteries — every moment is magic.",
    "tags": [
      "Travel",
      "India",
      "Adventure",
      "Ladakh",
      "Himalayas"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 4,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-030",
    "title": "Top 10 Street Foods in Bangkok You Must Try",
    "channel": {
      "id": "ch-006",
      "name": "GlobeTrekker",
      "handle": "@globetrekker",
      "subscribers": "620K",
      "avatarColor": "#ff9800",
      "initials": "GT",
      "verified": false
    },
    "category": "Travel",
    "views": "1.1M",
    "uploadedAt": "3 weeks ago",
    "duration": "15:22",
    "likes": "44K",
    "description": "Bangkok is a world-renowned street food paradise. Join us as we explore night markets and alleyway stalls for authentic pad thai, mango sticky rice, and tom yum soup.",
    "tags": [
      "Travel",
      "Thailand",
      "Food",
      "Bangkok",
      "Street Food"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 5,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-031",
    "title": "Hiking the Swiss Alps — Grindelwald & Matterhorn Trails",
    "channel": {
      "id": "ch-002",
      "name": "NovaNomad",
      "handle": "@novanomad",
      "subscribers": "845K",
      "avatarColor": "#ff6584",
      "initials": "NN",
      "verified": true
    },
    "category": "Travel",
    "views": "1.6M",
    "uploadedAt": "2 weeks ago",
    "duration": "32:15",
    "likes": "67K",
    "description": "Crystal alpine lakes, panoramic glacier views, and traditional mountain huts. A cinematic summer trekking itinerary through Switzerland.",
    "tags": [
      "Switzerland",
      "Alps",
      "Hiking",
      "Nature",
      "Travel"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 6,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-032",
    "title": "Kyoto Autumn Walk — Temples, Zen Gardens & Bamboo Groves",
    "channel": {
      "id": "ch-002",
      "name": "NovaNomad",
      "handle": "@novanomad",
      "subscribers": "845K",
      "avatarColor": "#ff6584",
      "initials": "NN",
      "verified": true
    },
    "category": "Travel",
    "views": "2.2M",
    "uploadedAt": "1 month ago",
    "duration": "40:05",
    "likes": "89K",
    "description": "Strolling through Kyoto during peak momiji autumn foliage. Gion historic tea houses, Fushimi Inari torii gates, and peaceful stone Zen gardens.",
    "tags": [
      "Japan",
      "Kyoto",
      "Autumn",
      "Walking Tour",
      "Travel"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 7,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-033",
    "title": "Iceland Road Trip Guide — Ring Road Waterfalls & Black Sand Beaches",
    "channel": {
      "id": "ch-002",
      "name": "NovaNomad",
      "handle": "@novanomad",
      "subscribers": "845K",
      "avatarColor": "#ff6584",
      "initials": "NN",
      "verified": true
    },
    "category": "Travel",
    "views": "1.4M",
    "uploadedAt": "3 weeks ago",
    "duration": "26:50",
    "likes": "58K",
    "description": "Navigating the 800-mile Icelandic Ring Road. Geysers, volcanic lava fields, glacial lagoons with blue icebergs, and midnight sun vistas.",
    "tags": [
      "Iceland",
      "Road Trip",
      "Nature",
      "Waterfalls",
      "Travel"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 8,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-034",
    "title": "Greek Islands Sailing Adventure — Santorini, Milos & Naxos",
    "channel": {
      "id": "ch-006",
      "name": "GlobeTrekker",
      "handle": "@globetrekker",
      "subscribers": "620K",
      "avatarColor": "#ff9800",
      "initials": "GT",
      "verified": false
    },
    "category": "Travel",
    "views": "980K",
    "uploadedAt": "1 month ago",
    "duration": "23:30",
    "likes": "41K",
    "description": "Sailing crystal turquoise waters across the Cyclades. White-washed cliffside villages, Aegean sunsets, and coastal Mediterranean dining.",
    "tags": [
      "Greece",
      "Sailing",
      "Santorini",
      "Islands",
      "Travel"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 9,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "fallbackUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4"
  },
  {
    "id": "vid-035",
    "title": "Quantum Computing Explained — No Physics Degree Needed",
    "channel": {
      "id": "ch-003",
      "name": "QuantumQuest",
      "handle": "@quantumquest",
      "subscribers": "2.1M",
      "avatarColor": "#43e97b",
      "initials": "QQ",
      "verified": true
    },
    "category": "Science",
    "views": "2.3M",
    "uploadedAt": "2 weeks ago",
    "duration": "19:52",
    "likes": "87K",
    "description": "Quantum mechanics sounds intimidating, but it doesn't have to be. We break down qubits, superposition, quantum entanglement, and quantum supremacy.",
    "tags": [
      "Science",
      "Quantum",
      "Physics",
      "Education"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 10,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-036",
    "title": "The Science of Sleep — Why 8 Hours Is a Myth",
    "channel": {
      "id": "ch-003",
      "name": "QuantumQuest",
      "handle": "@quantumquest",
      "subscribers": "2.1M",
      "avatarColor": "#43e97b",
      "initials": "QQ",
      "verified": true
    },
    "category": "Science",
    "views": "3.8M",
    "uploadedAt": "1 month ago",
    "duration": "22:45",
    "likes": "155K",
    "description": "Sleep science is far more nuanced than common wisdom suggests. Research on ultradian sleep cycles, chronotypes, adenosine buildup, and circadian rhythms.",
    "tags": [
      "Science",
      "Sleep",
      "Health",
      "Biology"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 11,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-037",
    "title": "James Webb Space Telescope — Deepest Cosmic Discoveries",
    "channel": {
      "id": "ch-003",
      "name": "QuantumQuest",
      "handle": "@quantumquest",
      "subscribers": "2.1M",
      "avatarColor": "#43e97b",
      "initials": "QQ",
      "verified": true
    },
    "category": "Science",
    "views": "4.5M",
    "uploadedAt": "2 weeks ago",
    "duration": "33:15",
    "likes": "188K",
    "description": "Unprecedented infrared views of early galaxies formed just 300 million years after the Big Bang, exoplanet atmospheres, and stellar nurseries.",
    "tags": [
      "Space",
      "Astronomy",
      "JWST",
      "Cosmology"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 0,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-038",
    "title": "CRISPR Gene Editing — The Revolution in Human Medicine",
    "channel": {
      "id": "ch-003",
      "name": "QuantumQuest",
      "handle": "@quantumquest",
      "subscribers": "2.1M",
      "avatarColor": "#43e97b",
      "initials": "QQ",
      "verified": true
    },
    "category": "Science",
    "views": "1.7M",
    "uploadedAt": "3 weeks ago",
    "duration": "27:08",
    "likes": "71K",
    "description": "How bacterial defense mechanisms were harnessed to edit DNA with molecular precision. Recent clinical trials treating sickle cell anemia and hereditary blindness.",
    "tags": [
      "Genetics",
      "CRISPR",
      "Biotech",
      "Medicine"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 1,
    "videoUrl": "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-039",
    "title": "Deep Ocean Mysteries — Creatures of the Hadal Trenches",
    "channel": {
      "id": "ch-003",
      "name": "QuantumQuest",
      "handle": "@quantumquest",
      "subscribers": "2.1M",
      "avatarColor": "#43e97b",
      "initials": "QQ",
      "verified": true
    },
    "category": "Science",
    "views": "2.9M",
    "uploadedAt": "1 month ago",
    "duration": "29:40",
    "likes": "112K",
    "description": "Descending 36,000 feet into the Mariana Trench. How extremophile organisms thrive under crushing hydrostatic pressure, freezing temperatures, and zero sunlight.",
    "tags": [
      "Ocean",
      "Marine Biology",
      "Exploration",
      "Science"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 2,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  },
  {
    "id": "vid-040",
    "title": "Perfect Neapolitan Pizza at Home — Step by Step Recipe",
    "channel": {
      "id": "ch-008",
      "name": "CulinaryCanvas",
      "handle": "@culinarycanvas",
      "subscribers": "930K",
      "avatarColor": "#ff5722",
      "initials": "CC",
      "verified": true
    },
    "category": "Cooking",
    "views": "680K",
    "uploadedAt": "3 weeks ago",
    "duration": "18:30",
    "likes": "27K",
    "description": "Authentic Neapolitan pizza requires high heat, Caputo 00 flour, and slow fermentation. Learn how to achieve leopard-spotted crusts in a home kitchen.",
    "tags": [
      "Cooking",
      "Pizza",
      "Italian",
      "Recipe",
      "Baking"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 3,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-041",
    "title": "Authentic Japanese Tonkotsu Ramen from Scratch",
    "channel": {
      "id": "ch-008",
      "name": "CulinaryCanvas",
      "handle": "@culinarycanvas",
      "subscribers": "930K",
      "avatarColor": "#ff5722",
      "initials": "CC",
      "verified": true
    },
    "category": "Cooking",
    "views": "1.9M",
    "uploadedAt": "1 week ago",
    "duration": "25:15",
    "likes": "82K",
    "description": "Simmering rich 18-hour pork bone broth, tender chashu pork belly, marinated ramen eggs, and hand-cut alkaline noodles. The definitive ramen guide.",
    "tags": [
      "Cooking",
      "Ramen",
      "Japanese",
      "Food",
      "Culinary"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 4,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-042",
    "title": "Beginner Sourdough Bread — Foolproof Loaf Guide",
    "channel": {
      "id": "ch-008",
      "name": "CulinaryCanvas",
      "handle": "@culinarycanvas",
      "subscribers": "930K",
      "avatarColor": "#ff5722",
      "initials": "CC",
      "verified": true
    },
    "category": "Cooking",
    "views": "1.3M",
    "uploadedAt": "2 weeks ago",
    "duration": "22:40",
    "likes": "54K",
    "description": "Everything you need to master sourdough: starter feeding cycles, stretch-and-folds, shaping technique, scoring patterns, and Dutch oven baking.",
    "tags": [
      "Baking",
      "Sourdough",
      "Bread",
      "Cooking"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 5,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-043",
    "title": "French Pastry Basics — The Secret to Flaky Croissants",
    "channel": {
      "id": "ch-008",
      "name": "CulinaryCanvas",
      "handle": "@culinarycanvas",
      "subscribers": "930K",
      "avatarColor": "#ff5722",
      "initials": "CC",
      "verified": true
    },
    "category": "Cooking",
    "views": "2.1M",
    "uploadedAt": "1 month ago",
    "duration": "30:10",
    "likes": "91K",
    "description": "Master laminating butter blocks into yeast dough. Learn folding turns, dough temperature control, proofing signs, and achieving honeycombed interiors.",
    "tags": [
      "Pastry",
      "Croissant",
      "French",
      "Baking",
      "Cooking"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 6,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  },
  {
    "id": "vid-044",
    "title": "Street Tacos Masterclass — Carne Asada & Handmade Corn Tortillas",
    "channel": {
      "id": "ch-008",
      "name": "CulinaryCanvas",
      "handle": "@culinarycanvas",
      "subscribers": "930K",
      "avatarColor": "#ff5722",
      "initials": "CC",
      "verified": true
    },
    "category": "Cooking",
    "views": "870K",
    "uploadedAt": "4 days ago",
    "duration": "16:50",
    "likes": "38K",
    "description": "Marinating flank steak with citrus, garlic, and Mexican spices over blazing charcoal. Paired with charred salsa verde and warm heirloom corn tortillas.",
    "tags": [
      "Tacos",
      "Mexican",
      "Street Food",
      "Cooking",
      "Grilling"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 7,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-045",
    "title": "Champions League Tactical Breakdown — The Masterclass Pressing",
    "channel": {
      "id": "ch-013",
      "name": "Apex Athletics",
      "handle": "@apexathletics",
      "subscribers": "1.6M",
      "avatarColor": "#00e676",
      "initials": "AA",
      "verified": true
    },
    "category": "Sports",
    "views": "1.5M",
    "uploadedAt": "3 days ago",
    "duration": "17:25",
    "likes": "59K",
    "description": "Detailed video analysis of passing lanes, counter-pressing triggers, inverted fullbacks, and defensive transition structures in top European football.",
    "tags": [
      "Football",
      "Soccer",
      "Tactics",
      "Sports",
      "Champions League"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 8,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-046",
    "title": "NBA Playoff Clutch Moments — Unforgettable Game Winners",
    "channel": {
      "id": "ch-013",
      "name": "Apex Athletics",
      "handle": "@apexathletics",
      "subscribers": "1.6M",
      "avatarColor": "#00e676",
      "initials": "AA",
      "verified": true
    },
    "category": "Sports",
    "views": "2.8M",
    "uploadedAt": "1 week ago",
    "duration": "20:15",
    "likes": "118K",
    "description": "Buzzer beaters, ankle breakers, and legendary fourth-quarter comebacks that defined basketball history. Slow-motion breakdowns and original broadcast audio.",
    "tags": [
      "Basketball",
      "NBA",
      "Clutch",
      "Highlights",
      "Sports"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 9,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-047",
    "title": "Marathon Training Blueprint — From First 5K to 26.2 Miles",
    "channel": {
      "id": "ch-013",
      "name": "Apex Athletics",
      "handle": "@apexathletics",
      "subscribers": "1.6M",
      "avatarColor": "#00e676",
      "initials": "AA",
      "verified": true
    },
    "category": "Sports",
    "views": "640K",
    "uploadedAt": "2 weeks ago",
    "duration": "35:40",
    "likes": "29K",
    "description": "Periodized mileage buildup, VO2 max interval sessions, race day nutrition fueling strategies, and injury prevention routines for distance runners.",
    "tags": [
      "Running",
      "Marathon",
      "Fitness",
      "Endurance",
      "Sports"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 10,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-048",
    "title": "Extreme Backcountry Snowboarding — Alaska Heli-Drops",
    "channel": {
      "id": "ch-013",
      "name": "Apex Athletics",
      "handle": "@apexathletics",
      "subscribers": "1.6M",
      "avatarColor": "#00e676",
      "initials": "AA",
      "verified": true
    },
    "category": "Sports",
    "views": "1.9M",
    "uploadedAt": "5 days ago",
    "duration": "14:50",
    "likes": "84K",
    "description": "Dropping onto vertical spine walls in the Alaskan Chugach range. High-velocity freeriding through deep powder filmed with 4K drone cinematography.",
    "tags": [
      "Snowboarding",
      "Extreme Sports",
      "Winter",
      "Adventure"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1565992441121-4367c2967103?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 11,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "fallbackUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4"
  },
  {
    "id": "vid-049",
    "title": "Tennis Grand Slam Finals — The Greatest Rallies in History",
    "channel": {
      "id": "ch-013",
      "name": "Apex Athletics",
      "handle": "@apexathletics",
      "subscribers": "1.6M",
      "avatarColor": "#00e676",
      "initials": "AA",
      "verified": true
    },
    "category": "Sports",
    "views": "1.2M",
    "uploadedAt": "3 weeks ago",
    "duration": "22:10",
    "likes": "51K",
    "description": "Epic 40-shot baseline rallies, miraculous drop shots, and championship-point nerves from Wimbledon, Roland Garros, and the US Open.",
    "tags": [
      "Tennis",
      "Grand Slam",
      "Rallies",
      "Sports",
      "Highlights"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 0,
    "videoUrl": "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-050",
    "title": "The Journey of Lumi — Award-Winning 3D Animated Short",
    "channel": {
      "id": "ch-011",
      "name": "NeonToons Studio",
      "handle": "@neontoons",
      "subscribers": "1.1M",
      "avatarColor": "#9c27b0",
      "initials": "NT",
      "verified": true
    },
    "category": "Animation",
    "views": "3.3M",
    "uploadedAt": "2 weeks ago",
    "duration": "08:45",
    "likes": "165K",
    "description": "A whimsical story of a tiny spark of light discovering an ancient mechanical forest. Hand-crafted character modeling and orchestral musical scoring.",
    "tags": [
      "Animation",
      "Short Film",
      "3D Art",
      "CGI",
      "CGI Short"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 1,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-051",
    "title": "Blender 4.3 Procedural World Generation with Geometry Nodes",
    "channel": {
      "id": "ch-011",
      "name": "NeonToons Studio",
      "handle": "@neontoons",
      "subscribers": "1.1M",
      "avatarColor": "#9c27b0",
      "initials": "NT",
      "verified": true
    },
    "category": "Animation",
    "views": "710K",
    "uploadedAt": "1 week ago",
    "duration": "29:30",
    "likes": "34K",
    "description": "Learn to build infinite procedural terrain, vegetation scatter, and stylized shading shaders in Blender without destructive sculpting.",
    "tags": [
      "Blender",
      "Animation",
      "3D Modeling",
      "Geometry Nodes"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 2,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-052",
    "title": "Anime Action Sakuga Breakdown — Frame by Frame Masterclasses",
    "channel": {
      "id": "ch-011",
      "name": "NeonToons Studio",
      "handle": "@neontoons",
      "subscribers": "1.1M",
      "avatarColor": "#9c27b0",
      "initials": "NT",
      "verified": true
    },
    "category": "Animation",
    "views": "1.4M",
    "uploadedAt": "3 weeks ago",
    "duration": "19:40",
    "likes": "62K",
    "description": "Analyzing impact frames, smear frames, perspective distortion, and kinetic choreography in legendary Japanese animation sequences.",
    "tags": [
      "Anime",
      "Sakuga",
      "2D Animation",
      "Art Breakdown"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 3,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-053",
    "title": "Motion Graphics Showreel 2026 — Kinetic Typography & Branding",
    "channel": {
      "id": "ch-011",
      "name": "NeonToons Studio",
      "handle": "@neontoons",
      "subscribers": "1.1M",
      "avatarColor": "#9c27b0",
      "initials": "NT",
      "verified": true
    },
    "category": "Animation",
    "views": "490K",
    "uploadedAt": "4 days ago",
    "duration": "04:15",
    "likes": "22K",
    "description": "A dynamic showcase of kinetic type, 3D brand IDs, title sequences, and UI motion design created in After Effects and Cinema 4D.",
    "tags": [
      "Motion Design",
      "After Effects",
      "Typography",
      "Animation"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 4,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-054",
    "title": "Behind the Scenes — The Art of Claymation & Stop Motion",
    "channel": {
      "id": "ch-011",
      "name": "NeonToons Studio",
      "handle": "@neontoons",
      "subscribers": "1.1M",
      "avatarColor": "#9c27b0",
      "initials": "NT",
      "verified": true
    },
    "category": "Animation",
    "views": "880K",
    "uploadedAt": "1 month ago",
    "duration": "24:50",
    "likes": "45K",
    "description": "Armature fabrication, silicone molding, replacement mouth sets, and shooting 24 frames per second by hand with dragonframe software.",
    "tags": [
      "Stop Motion",
      "Claymation",
      "Filmmaking",
      "Animation"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 5,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  },
  {
    "id": "vid-055",
    "title": "Under the Canopy — Secrets of the Amazon Rainforest",
    "channel": {
      "id": "ch-009",
      "name": "BioSphere Earth",
      "handle": "@biosphere",
      "subscribers": "1.4M",
      "avatarColor": "#8bc34a",
      "initials": "BE",
      "verified": true
    },
    "category": "Documentary",
    "views": "2.5M",
    "uploadedAt": "2 weeks ago",
    "duration": "52:10",
    "likes": "109K",
    "description": "An intimate wildlife expedition into the heart of the Amazon basin. Documenting jaguars, harpy eagles, poison dart frogs, and Indigenous forest stewards.",
    "tags": [
      "Documentary",
      "Nature",
      "Wildlife",
      "Amazon",
      "Earth"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1534567153574-2b12153a87f0?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 6,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-056",
    "title": "The Rise and Fall of Silicon Valley Hardware Giants",
    "channel": {
      "id": "ch-009",
      "name": "BioSphere Earth",
      "handle": "@biosphere",
      "subscribers": "1.4M",
      "avatarColor": "#8bc34a",
      "initials": "BE",
      "verified": true
    },
    "category": "Documentary",
    "views": "1.8M",
    "uploadedAt": "3 weeks ago",
    "duration": "48:30",
    "likes": "77K",
    "description": "The untold corporate battles, revolutionary prototypes, and catastrophic pivot decisions that reshaped personal computing from garages to Wall Street.",
    "tags": [
      "Documentary",
      "Tech History",
      "Silicon Valley",
      "Business"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 7,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-057",
    "title": "Sahara Nomads — Life in the Worlds Largest Hot Desert",
    "channel": {
      "id": "ch-009",
      "name": "BioSphere Earth",
      "handle": "@biosphere",
      "subscribers": "1.4M",
      "avatarColor": "#8bc34a",
      "initials": "BE",
      "verified": true
    },
    "category": "Documentary",
    "views": "1.1M",
    "uploadedAt": "1 month ago",
    "duration": "38:15",
    "likes": "46K",
    "description": "Following Tuareg camel caravans traversing towering sand dunes and discovering ancient oases in North Africa. A story of human resilience.",
    "tags": [
      "Documentary",
      "Sahara",
      "Culture",
      "Desert",
      "Travel"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 8,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-058",
    "title": "Predators of the Serengeti — The Great Annual Migration",
    "channel": {
      "id": "ch-009",
      "name": "BioSphere Earth",
      "handle": "@biosphere",
      "subscribers": "1.4M",
      "avatarColor": "#8bc34a",
      "initials": "BE",
      "verified": true
    },
    "category": "Documentary",
    "views": "3.7M",
    "uploadedAt": "2 weeks ago",
    "duration": "46:40",
    "likes": "162K",
    "description": "Two million wildebeest and zebras crossing crocodile-infested Mara River waters while prides of lions and cheetahs stalk the savannah plains.",
    "tags": [
      "Wildlife",
      "Africa",
      "Serengeti",
      "Documentary",
      "Animals"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1546182990-dffeafbe841d?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 9,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-059",
    "title": "Renaissance Masters — The Lost Techniques of Leonardo da Vinci",
    "channel": {
      "id": "ch-009",
      "name": "BioSphere Earth",
      "handle": "@biosphere",
      "subscribers": "1.4M",
      "avatarColor": "#8bc34a",
      "initials": "BE",
      "verified": true
    },
    "category": "Documentary",
    "views": "840K",
    "uploadedAt": "1 month ago",
    "duration": "36:00",
    "likes": "38K",
    "description": "High-resolution multispectral scanning of the Mona Lisa, Vitruvian Man, and secret sketchbooks revealing groundbreaking anatomical and optical insights.",
    "tags": [
      "Art History",
      "Renaissance",
      "Da Vinci",
      "Documentary"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 10,
    "videoUrl": "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-060",
    "title": "Living with Roommates — Modern Dating and Life in Your 20s",
    "channel": {
      "id": "ch-012",
      "name": "StandUp Central",
      "handle": "@standupcentral",
      "subscribers": "2.8M",
      "avatarColor": "#ffc107",
      "initials": "SC",
      "verified": true
    },
    "category": "Comedy",
    "views": "2.6M",
    "uploadedAt": "6 days ago",
    "duration": "18:20",
    "likes": "145K",
    "description": "A hilarious live stand-up comedy special tackling microwave etiquette, group chats, remote work Zoom faux pas, and budgeting nightmares.",
    "tags": [
      "Comedy",
      "Standup",
      "Humor",
      "Relatable",
      "Entertainment"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 11,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-061",
    "title": "If Programmers Were Honest in Job Interviews",
    "channel": {
      "id": "ch-012",
      "name": "StandUp Central",
      "handle": "@standupcentral",
      "subscribers": "2.8M",
      "avatarColor": "#ffc107",
      "initials": "SC",
      "verified": true
    },
    "category": "Comedy",
    "views": "4.2M",
    "uploadedAt": "1 week ago",
    "duration": "06:45",
    "likes": "230K",
    "description": "What happens when a software engineer tells the 100% unvarnished truth about copying from Stack Overflow, inverted binary trees, and fixing bugs by restarting.",
    "tags": [
      "Comedy",
      "Programming",
      "Satire",
      "Work",
      "Tech Humor"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 0,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-062",
    "title": "The Over-Complicated Coffee Shop Order Sketch",
    "channel": {
      "id": "ch-012",
      "name": "StandUp Central",
      "handle": "@standupcentral",
      "subscribers": "2.8M",
      "avatarColor": "#ffc107",
      "initials": "SC",
      "verified": true
    },
    "category": "Comedy",
    "views": "1.5M",
    "uploadedAt": "2 weeks ago",
    "duration": "05:30",
    "likes": "88K",
    "description": "A customer attempts to order a simple drip coffee in an artisanal coffee roastery with 45 plant milks, temperature degrees, and bespoke oat infusions.",
    "tags": [
      "Sketch Comedy",
      "Funny",
      "Coffee",
      "Satire"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 1,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  },
  {
    "id": "vid-063",
    "title": "National Improv Comedy Championship Finals",
    "channel": {
      "id": "ch-012",
      "name": "StandUp Central",
      "handle": "@standupcentral",
      "subscribers": "2.8M",
      "avatarColor": "#ffc107",
      "initials": "SC",
      "verified": true
    },
    "category": "Comedy",
    "views": "920K",
    "uploadedAt": "3 weeks ago",
    "duration": "27:10",
    "likes": "47K",
    "description": "Unscripted brilliance where audience suggestions turn into musical showdowns, absurd detective mysteries, and spontaneous physical comedy.",
    "tags": [
      "Improv",
      "Comedy",
      "Theater",
      "Laughs"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1514306191717-452ec28c7814?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 2,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-064",
    "title": "Every Airport Security Line Ever",
    "channel": {
      "id": "ch-012",
      "name": "StandUp Central",
      "handle": "@standupcentral",
      "subscribers": "2.8M",
      "avatarColor": "#ffc107",
      "initials": "SC",
      "verified": true
    },
    "category": "Comedy",
    "views": "3.1M",
    "uploadedAt": "1 month ago",
    "duration": "07:55",
    "likes": "172K",
    "description": "Shoe removal panics, boarding pass misplacements, laptops stuck in bins, and the person carrying a giant bottle of shampoo. We have all been there.",
    "tags": [
      "Airport",
      "Relatable",
      "Comedy",
      "Travel Humor"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1527224857830-43a7acc85260?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 3,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  },
  {
    "id": "vid-065",
    "title": "Global Economy 2026 — Interest Rates, Inflation & Tech Forecast",
    "channel": {
      "id": "ch-014",
      "name": "GlobalChronicle",
      "handle": "@globalchronicle",
      "subscribers": "3.1M",
      "avatarColor": "#3f51b5",
      "initials": "GC",
      "verified": true
    },
    "category": "News",
    "views": "1.4M",
    "uploadedAt": "1 day ago",
    "duration": "18:40",
    "likes": "49K",
    "description": "Comprehensive analysis of central bank monetary policy, global supply chain reshoring, energy market shifts, and technology venture capital trends.",
    "tags": [
      "News",
      "Economy",
      "Finance",
      "Markets",
      "Global"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 4,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-066",
    "title": "Space Exploration Roadmap — The Next Lunar Bases & Mars Missions",
    "channel": {
      "id": "ch-014",
      "name": "GlobalChronicle",
      "handle": "@globalchronicle",
      "subscribers": "3.1M",
      "avatarColor": "#3f51b5",
      "initials": "GC",
      "verified": true
    },
    "category": "News",
    "views": "2.2M",
    "uploadedAt": "4 days ago",
    "duration": "22:15",
    "likes": "95K",
    "description": "International Artemis program milestones, reusable super-heavy rocket flights, and the private space stations slated for low-Earth orbit deployment.",
    "tags": [
      "News",
      "Space",
      "NASA",
      "Technology",
      "Future"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 5,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-067",
    "title": "Renewable Energy Milestones — Solar & Wind Surpass Fossil Fuels",
    "channel": {
      "id": "ch-014",
      "name": "GlobalChronicle",
      "handle": "@globalchronicle",
      "subscribers": "3.1M",
      "avatarColor": "#3f51b5",
      "initials": "GC",
      "verified": true
    },
    "category": "News",
    "views": "980K",
    "uploadedAt": "6 days ago",
    "duration": "15:50",
    "likes": "42K",
    "description": "Grid-scale battery storage breakthroughs and offshore wind installations drive a historic shift toward clean electric power across five continents.",
    "tags": [
      "News",
      "Energy",
      "Climate",
      "Sustainability",
      "Technology"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 6,
    "videoUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-068",
    "title": "World Technology Summit 2026 — Keynote Highlights & Takeaways",
    "channel": {
      "id": "ch-014",
      "name": "GlobalChronicle",
      "handle": "@globalchronicle",
      "subscribers": "3.1M",
      "avatarColor": "#3f51b5",
      "initials": "GC",
      "verified": true
    },
    "category": "News",
    "views": "1.7M",
    "uploadedAt": "2 weeks ago",
    "duration": "25:30",
    "likes": "64K",
    "description": "Leading researchers and tech CEOs debate open-source AI models, digital privacy regulations, quantum breakthroughs, and biotechnology ethics.",
    "tags": [
      "Tech News",
      "Conference",
      "AI",
      "Silicon Valley"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 7,
    "videoUrl": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "fallbackUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4"
  },
  {
    "id": "vid-069",
    "title": "30-Minute Full Body HIIT Workout — No Equipment Needed",
    "channel": {
      "id": "ch-010",
      "name": "IronPulse Fitness",
      "handle": "@ironpulse",
      "subscribers": "710K",
      "avatarColor": "#00bcd4",
      "initials": "IP",
      "verified": false
    },
    "category": "Fitness",
    "views": "2.7M",
    "uploadedAt": "5 days ago",
    "duration": "31:20",
    "likes": "135K",
    "description": "High intensity interval training with built-in rest periods. Burn calories, build cardiovascular endurance, and strengthen your core right in your living room.",
    "tags": [
      "Fitness",
      "Workout",
      "HIIT",
      "Home Workout",
      "Health"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 8,
    "videoUrl": "https://vjs.zencdn.net/v/oceans.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/mov_bbb.mp4"
  },
  {
    "id": "vid-070",
    "title": "Calisthenics for Beginners — Unlock Your First Pull-Up & Dip",
    "channel": {
      "id": "ch-010",
      "name": "IronPulse Fitness",
      "handle": "@ironpulse",
      "subscribers": "710K",
      "avatarColor": "#00bcd4",
      "initials": "IP",
      "verified": false
    },
    "category": "Fitness",
    "views": "1.1M",
    "uploadedAt": "2 weeks ago",
    "duration": "19:45",
    "likes": "58K",
    "description": "Progressive bodyweight strength training for shoulders, back, and core. Resistance band assists, scapular retractions, and proper joint stabilization.",
    "tags": [
      "Calisthenics",
      "Bodyweight",
      "Fitness",
      "Strength"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 9,
    "videoUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "fallbackUrl": "https://www.w3schools.com/html/movie.mp4"
  },
  {
    "id": "vid-071",
    "title": "Daily Mobility & Full Body Stretching Routine for Desk Workers",
    "channel": {
      "id": "ch-010",
      "name": "IronPulse Fitness",
      "handle": "@ironpulse",
      "subscribers": "710K",
      "avatarColor": "#00bcd4",
      "initials": "IP",
      "verified": false
    },
    "category": "Fitness",
    "views": "3.9M",
    "uploadedAt": "3 weeks ago",
    "duration": "15:10",
    "likes": "195K",
    "description": "Relieve lower back tightness, open stiff hips, and correct forward head posture with this gentle 15-minute follow-along physical therapy routine.",
    "tags": [
      "Stretching",
      "Mobility",
      "Posture",
      "Health",
      "Fitness"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 10,
    "videoUrl": "https://www.w3schools.com/html/movie.mp4",
    "fallbackUrl": "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    "id": "vid-072",
    "title": "The Science of Muscle Growth — Training Frequency & Hypertrophy",
    "channel": {
      "id": "ch-010",
      "name": "IronPulse Fitness",
      "handle": "@ironpulse",
      "subscribers": "710K",
      "avatarColor": "#00bcd4",
      "initials": "IP",
      "verified": false
    },
    "category": "Fitness",
    "views": "1.6M",
    "uploadedAt": "1 month ago",
    "duration": "23:45",
    "likes": "74K",
    "description": "Evidence-based breakdown of mechanical tension, metabolic stress, protein synthesis timing, progressive overload, and effective recovery protocols.",
    "tags": [
      "Fitness",
      "Hypertrophy",
      "Strength Training",
      "Science"
    ],
    "thumbnailUrl": "https://images.unsplash.com/photo-1574680096145-d05b474e2155?auto=format&fit=crop&w=640&q=80",
    "thumbnailIndex": 11,
    "videoUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4",
    "fallbackUrl": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4"
  }
];

export const MOCK_COMMENTS = [
  {
    id: 'cmt-001',
    author: 'Priya Sharma',
    authorInitials: 'PS',
    authorColor: '#6c63ff',
    text: 'This is exactly what I needed! The explanation was super clear and practical. Thank you!',
    likes: 248,
    timeAgo: '2 hours ago',
    replies: 12,
  },
  {
    id: 'cmt-002',
    author: 'Arjun Mehta',
    authorInitials: 'AM',
    authorColor: '#43e97b',
    text: "Great video as always! I've been following this channel for months and the video quality keeps improving 🔥",
    likes: 184,
    timeAgo: '5 hours ago',
    replies: 8,
  },
  {
    id: 'cmt-003',
    author: 'Sneha Patel',
    authorInitials: 'SP',
    authorColor: '#ff6584',
    text: "Could you do a follow-up deep dive on this? The production values and pacing are top tier.",
    likes: 97,
    timeAgo: '8 hours ago',
    replies: 3,
  },
  {
    id: 'cmt-004',
    author: 'Rahul Verma',
    authorInitials: 'RV',
    authorColor: '#f9a825',
    text: 'I watched this twice already to take complete notes. Timestamp 14:20 is pure gold.',
    likes: 312,
    timeAgo: '1 day ago',
    replies: 21,
  },
  {
    id: 'cmt-005',
    author: 'Kavya Nair',
    authorInitials: 'KN',
    authorColor: '#40c4ff',
    text: "Finally a video that doesn't skip the 'why' behind the 'how'. Beautifully presented!",
    likes: 156,
    timeAgo: '2 days ago',
    replies: 5,
  },
];

export const SIDEBAR_SECTIONS = [
  {
    title: null,
    items: [
      { id: 'home', label: 'Home', icon: 'Home', path: '/' },
      { id: 'trending', label: 'Trending', icon: 'TrendingUp', path: '/trending' },
      { id: 'subscriptions', label: 'Subscriptions', icon: 'PlaySquare', path: '/subscriptions' },
    ],
  },
  {
    title: 'Library',
    items: [
      { id: 'history', label: 'History', icon: 'History', path: '/history' },
      { id: 'watch-later', label: 'Watch Later', icon: 'Clock', path: '/watch-later' },
      { id: 'liked', label: 'Liked Videos', icon: 'ThumbsUp', path: '/liked' },
      { id: 'downloads', label: 'Downloads', icon: 'Download', path: '/downloads' },
      { id: 'security', label: 'Security & Devices', icon: 'Shield', path: '/security' },
      { id: 'upgrade', label: 'Upgrade Plan', icon: 'Sparkles', path: '/upgrade' },
    ],
  },
  {
    title: 'Explore',
    items: [
      { id: 'technology', label: 'Technology', icon: 'Laptop', path: '/category/technology' },
      { id: 'gaming', label: 'Gaming', icon: 'Gamepad2', path: '/category/gaming' },
      { id: 'music', label: 'Music', icon: 'Music', path: '/category/music' },
      { id: 'education', label: 'Education', icon: 'BookOpen', path: '/category/education' },
      { id: 'travel', label: 'Travel', icon: 'Compass', path: '/category/travel' },
      { id: 'science', label: 'Science', icon: 'Atom', path: '/category/science' },
      { id: 'cooking', label: 'Cooking', icon: 'Utensils', path: '/category/cooking' },
      { id: 'sports', label: 'Sports', icon: 'Trophy', path: '/category/sports' },
      { id: 'animation', label: 'Animation', icon: 'Film', path: '/category/animation' },
      { id: 'documentary', label: 'Documentary', icon: 'Globe', path: '/category/documentary' },
      { id: 'comedy', label: 'Comedy', icon: 'Smile', path: '/category/comedy' },
      { id: 'news', label: 'News', icon: 'Newspaper', path: '/category/news' },
      { id: 'fitness', label: 'Fitness', icon: 'Dumbbell', path: '/category/fitness' },
    ],
  },
];
