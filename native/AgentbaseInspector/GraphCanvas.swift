import SwiftUI
import AppKit
import Combine

struct GraphNode: Decodable, Identifiable {
    let id: String; let kind: String; let title: String; let summary: String; let status: String; let uri: String?; let degree: Int
}
struct GraphEdge: Decodable, Hashable { let source: String; let target: String; let relation: String }
struct UnresolvedGraphLink: Decodable { let source: String; let label: String; let reason: String }
struct GraphPayload: Decodable { let nodes: [GraphNode]; let edges: [GraphEdge]; let omitted_nodes: Int; let total_nodes: Int; let unresolved: [UnresolvedGraphLink]?; let omitted_edges: Int?; let source_truncated: Bool? }
func graphSearch(_ nodes: [GraphNode], query: String) -> [GraphNode] {
    let phrase = query.trimmingCharacters(in:.whitespacesAndNewlines)
    let words = phrase.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    guard !words.isEmpty else {return nodes}
    func score(_ node: GraphNode) -> Int {
        if node.title.compare(phrase,options:[.caseInsensitive,.diacriticInsensitive]) == .orderedSame {return 0}
        if node.title.range(of:phrase,options:[.caseInsensitive,.diacriticInsensitive,.anchored]) != nil {return 1}
        if words.allSatisfy({node.title.localizedStandardContains($0)}) {return 2}
        return 3
    }
    return nodes.filter {node in words.allSatisfy {(node.title + " " + node.summary).localizedStandardContains($0)}}.sorted {
        let a=score($0), b=score($1)
        return a != b ? a < b : ($0.title != $1.title ? $0.title.localizedStandardCompare($1.title) == .orderedAscending : $0.id < $1.id)
    }
}
func graphColor(_ kind: String) -> Color {
    switch kind { case "project": return Color(red:0.88,green:0.90,blue:0.94); case "concept": return Color(red: 0.64, green: 0.60, blue: 0.97); case "task": return accent; case "resource", "dataset": return Color(red: 0.91, green: 0.70, blue: 0.38); case "analysis": return .pink; case "memory", "decision": return Color(red: 0.43, green: 0.70, blue: 0.96); case "plan": return .orange; default: return Color.gray }
}
struct GraphParticle { var point: CGPoint; var velocity: CGPoint = .zero }
private struct IndexedGraphSpring {
    let source: Int
    let target: Int
    let bias: Double
    let strength: Double
}
struct GraphCameraState: Equatable {
    let scale: CGFloat
    let center: CGPoint
    init(scale: CGFloat, offset: CGPoint) {
        self.scale = scale
        center = CGPoint(x:-offset.x/max(0.001,scale),y:-offset.y/max(0.001,scale))
    }
    init?(stored: [Double]) {
        guard stored.count == 3, stored.allSatisfy(\.isFinite), stored[0] >= 0.12, stored[0] <= 5 else { return nil }
        scale = CGFloat(stored[0]); center = CGPoint(x:stored[1],y:stored[2])
    }
    var offset: CGPoint { CGPoint(x:-center.x*scale,y:-center.y*scale) }
    var stored: [Double] { [Double(scale),Double(center.x),Double(center.y)] }
}
enum GraphCameraPersistence {
    static func key(project: String, localFocus: String? = nil) -> String {
        let base = "agentbase.graph.camera.\(project)"
        return localFocus.map { "\(base).local.\($0)" } ?? base
    }
    static func save(_ camera: GraphCameraState, key: String, defaults: UserDefaults = .standard) {
        defaults.set(camera.stored,forKey:key)
    }
    static func load(key: String, defaults: UserDefaults = .standard) -> GraphCameraState? {
        guard let stored = defaults.array(forKey:key) as? [Double] else { return nil }
        return GraphCameraState(stored:stored)
    }
}
@MainActor final class GraphLayout: ObservableObject {
    @Published var particles: [String: GraphParticle] = [:]
    var nodes: [GraphNode] = []; var edges: [GraphEdge] = []
    private var settledFrames = 0
    // Convergence is used for camera fitting only. It never disables the forces.
    var isSettled: Bool { pinned == nil && settledFrames >= 12 }
    func invalidateSettlement() { settledFrames = 0 }
    private var simulationTimer: Timer?
    private(set) var clockTickCount = 0
    var clockIsRunning: Bool { simulationTimer?.isValid == true }
    func setSimulationRunning(_ running: Bool) {
        guard running else { simulationTimer?.invalidate(); simulationTimer = nil; return }
        guard !clockIsRunning else { return }
        // The clock must share the StateObject's lifetime, not a transient View
        // value. Common modes keep ticks flowing while AppKit tracks a drag.
        let timer = Timer(timeInterval:1.0/30,repeats:true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.clockTickCount += 1
                self.step()
            }
        }
        simulationTimer = timer
        RunLoop.main.add(timer,forMode:.common)
    }
    deinit { simulationTimer?.invalidate() }
    private var nodeIndices: [String: Int] = [:]
    private var springs: [IndexedGraphSpring] = []
    var pinned: String?; var gravity = 0.12; var gravityEnabled = true; var repulsion = 2200.0
    var linkStrength = 0.015; var linkDistance = 1.0
    @Published var births: [String: TimeInterval] = [:]
    var edgeBirths: [GraphEdge: TimeInterval] = [:]
    func sync(nodes: [GraphNode], edges: [GraphEdge], newIDs: Set<String> = [], now: TimeInterval = Date.timeIntervalSinceReferenceDate) {
        let ids = Set(nodes.map(\.id)); let changed = Set(self.nodes.map(\.id)) != ids || Set(self.edges) != Set(edges)
        let hadExisting = !particles.isEmpty; let previousEdges = Set(self.edges)
        self.nodes = nodes; self.edges = edges
        nodeIndices = Dictionary(uniqueKeysWithValues: nodes.enumerated().map { ($0.element.id, $0.offset) })
        // A pair may have several semantic relations, but only one physical spring.
        var pairs = Set<String>()
        let links = edges.compactMap { edge -> (Int,Int)? in
            guard let a = nodeIndices[edge.source], let b = nodeIndices[edge.target], a != b else { return nil }
            guard pairs.insert("\(min(a,b)):\(max(a,b))").inserted else { return nil }
            return (a,b)
        }
        var degrees = Array(repeating:0,count:nodes.count)
        for (a,b) in links { degrees[a] += 1; degrees[b] += 1 }
        springs = links.map { a,b in
            IndexedGraphSpring(source:a,target:b,bias:Double(degrees[a])/Double(degrees[a]+degrees[b]),strength:1/sqrt(Double(min(degrees[a],degrees[b]))))
        }
        var updated = particles.filter { ids.contains($0.key) }
        var hierarchy: [String: GraphEdge] = [:]
        var adjacency: [String:[String]] = [:]
        func priority(_ relation: String) -> Int { relation == "child" ? 3 : relation == "plan" ? 2 : relation == "contains" ? 1 : 0 }
        for edge in edges {
            adjacency[edge.source,default:[]].append(edge.target)
            adjacency[edge.target,default:[]].append(edge.source)
            if priority(edge.relation) > 0 {
                let child = edge.relation == "plan" ? edge.source : edge.target
                if priority(edge.relation) > priority(hierarchy[child]?.relation ?? "") { hierarchy[child] = edge }
            }
        }
        var pending = nodes.enumerated().filter { updated[$0.element.id] == nil }
        while !pending.isEmpty {
            let ready = pending.filter { _, node in
                guard node.kind != "project", let edge = hierarchy[node.id] else { return node.kind == "project" }
                return updated[edge.source == node.id ? edge.target : edge.source] != nil
            }
            let batch = ready.isEmpty ? [pending[0]] : ready
            for (i,node) in batch {
                let angle = Double(i) * 2.399963; let radius = 25 + sqrt(Double(i + 1)) * 35
                let parent = hierarchy[node.id].flatMap { edge in
                    updated[edge.source == node.id ? edge.target : edge.source] == nil ? nil : edge
                }
                let connected = (adjacency[node.id] ?? []).compactMap { updated[$0]?.point }
                let point: CGPoint
                if node.kind == "project" && !hadExisting {
                    let projectIndex = nodes[..<i].filter { $0.kind == "project" }.count
                    let projectCount = max(1, nodes.filter { $0.kind == "project" }.count)
                    let projectAngle = 2 * Double.pi * Double(projectIndex) / Double(projectCount)
                    point = projectCount == 1 ? .zero : CGPoint(x: cos(projectAngle) * 180, y: sin(projectAngle) * 180)
                }
                else if let parent {
                    let anchor = updated[parent.source == node.id ? parent.target : parent.source]!.point
                    let distance = (parent.relation == "contains" ? 180.0 : parent.relation == "child" ? 100.0 : 135.0) * linkDistance
                    point = CGPoint(x:anchor.x + cos(angle)*distance,y:anchor.y + sin(angle)*distance)
                }
                else if !connected.isEmpty {
                    let x = connected.map(\.x).reduce(0,+) / Double(connected.count), y = connected.map(\.y).reduce(0,+) / Double(connected.count)
                    point = CGPoint(x:x + cos(angle)*100,y:y + sin(angle)*100)
                } else { point = CGPoint(x:cos(angle)*radius,y:sin(angle)*radius) }
                updated[node.id] = GraphParticle(point:point)
            }
            let placed = Set(batch.map { $0.element.id })
            pending.removeAll { placed.contains($0.element.id) }
        }
        particles = updated
        births = births.filter { ids.contains($0.key) && now - $0.value < 3 }
        for id in newIDs where ids.contains(id) { births[id] = now }
        let edgeSet = Set(edges)
        edgeBirths = edgeBirths.filter { edgeSet.contains($0.key) && now - $0.value < 3 }
        if hadExisting { for edge in edges where !previousEdges.contains(edge) { edgeBirths[edge] = now } }
        if changed { invalidateSettlement() }
    }
    func appearance(_ id: String, now: TimeInterval = Date.timeIntervalSinceReferenceDate) -> Double {
        guard let start = births[id] else { return 1 }; let t = min(1,max(0,(now-start)/0.8)); return t*t*(3-2*t)
    }
    func step() {
        guard !nodes.isEmpty else { return }
        var values = nodes.map { particles[$0.id] ?? GraphParticle(point: .zero) }
        var forces = Array(repeating: CGPoint.zero, count: nodes.count)
        do {
            for i in nodes.indices {
                for j in nodes.indices where j > i {
                    var dx = values[i].point.x - values[j].point.x, dy = values[i].point.y - values[j].point.y
                    if abs(dx) + abs(dy) < 0.01 { dx = Double(i + 1) * 0.01; dy = 0.1 }
                    let d2 = max(70, dx * dx + dy * dy); let d = sqrt(d2)
                    let force = min(18, repulsion * 0.015 / d)
                    let fx = dx / d * force, fy = dy / d * force
                    forces[i].x += fx; forces[i].y += fy; forces[j].x -= fx; forces[j].y -= fy
                    let overlap = min(3, max(0, 28 - d) * 0.1)
                    forces[i].x += dx / d * overlap; forces[i].y += dy / d * overlap
                    forces[j].x -= dx / d * overlap; forces[j].y -= dy / d * overlap
                }
            }
        }
        if gravityEnabled { for i in nodes.indices {
            forces[i].x -= values[i].point.x * gravity * 0.04
            forces[i].y -= values[i].point.y * gravity * 0.04
        } }
        for spring in springs {
            let a = spring.source, b = spring.target
            let dx = values[b].point.x - values[a].point.x, dy = values[b].point.y - values[a].point.y
            let distance = max(1, hypot(dx,dy))
            let force = (distance - 100 * linkDistance) * linkStrength * spring.strength * 2
            forces[a].x += dx / distance * force * (1-spring.bias); forces[a].y += dy / distance * force * (1-spring.bias)
            forces[b].x -= dx / distance * force * spring.bias; forces[b].y -= dy / distance * force * spring.bias
        }
        var maxMovement = 0.0
        for i in nodes.indices where nodes[i].id != pinned {
            values[i].velocity.x = (values[i].velocity.x + forces[i].x) * 0.82
            values[i].velocity.y = (values[i].velocity.y + forces[i].y) * 0.82
            let dx = max(-14,min(14,values[i].velocity.x)), dy = max(-14,min(14,values[i].velocity.y))
            values[i].point.x += dx; values[i].point.y += dy
            maxMovement = max(maxMovement,hypot(dx,dy))
            if !values[i].point.x.isFinite || !values[i].point.y.isFinite { values[i] = GraphParticle(point: .zero) }
        }
        settledFrames = maxMovement < 0.1 && pinned == nil ? min(12,settledFrames+1) : 0
        particles = Dictionary(uniqueKeysWithValues: nodes.enumerated().map { ($0.element.id, values[$0.offset]) })
    }
    func drag(_ id: String, to point: CGPoint) {
        pinned = id
        particles[id] = GraphParticle(point: point)
        invalidateSettlement()
    }
    func release() { pinned = nil; invalidateSettlement() }
    func resetPositions() {
        let currentNodes = nodes, currentEdges = edges
        particles = [:]; pinned = nil
        sync(nodes: currentNodes, edges: currentEdges)
        invalidateSettlement()
    }
    func neighbors(_ id: String, depth: Int = 1) -> Set<String> {
        var visited: Set<String> = [id], frontier = visited
        for _ in 0..<depth { var next = Set<String>(); for edge in edges where edge.relation != "contains" || edge.source == id { if frontier.contains(edge.source) { next.insert(edge.target) }; if frontier.contains(edge.target) { next.insert(edge.source) } }; next.subtract(visited); visited.formUnion(next); frontier = next }
        return visited
    }
}

struct GraphPointerSurface: NSViewRepresentable {
    let down: (CGPoint, Int) -> Void; let moved: (CGPoint) -> Void; let up: () -> Void
    let zoom: (CGFloat, CGPoint) -> Void; let hover: (CGPoint?) -> Void; let key: (String) -> Void
    let resultFrames: [String:CGRect]
    let results: [GraphNode]
    let chooseResult: (GraphNode) -> Void
    func makeNSView(context: Context) -> PointerView { let view = PointerView(); updateNSView(view, context: context); return view }
    func updateNSView(_ view: PointerView, context: Context) {
        view.down = down; view.moved = moved; view.up = up; view.zoom = zoom; view.hover = hover; view.key = key
        view.searchResultAtPoint = { point in
            guard let result = results.first(where:{ resultFrames[$0.id]?.contains(point) == true }) else { return nil }
            return result
        }
        view.chooseResult = chooseResult
    }
    final class PointerView: NSView {
        var down: ((CGPoint, Int) -> Void)?; var moved: ((CGPoint) -> Void)?; var up: (() -> Void)?; var zoom: ((CGFloat,CGPoint) -> Void)?; var hover: ((CGPoint?) -> Void)?; var key: ((String) -> Void)?
        var searchResultAtPoint: ((CGPoint) -> GraphNode?)?
        var chooseResult: ((GraphNode) -> Void)?
        private var pendingSearchResult: GraphNode?
        override var isFlipped: Bool { true }
        override var acceptsFirstResponder: Bool { true }
        override func updateTrackingAreas() { super.updateTrackingAreas(); for area in trackingAreas { removeTrackingArea(area) }; addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved,.mouseEnteredAndExited,.activeInKeyWindow,.inVisibleRect], owner: self)) }
        override func mouseDown(with event: NSEvent) {
            let point = convert(event.locationInWindow, from:nil)
            pendingSearchResult = searchResultAtPoint?(point)
            if pendingSearchResult != nil { return }
            window?.makeFirstResponder(self); down?(point,event.clickCount)
        }
        override func mouseDragged(with event: NSEvent) { guard pendingSearchResult == nil else { return }; moved?(convert(event.locationInWindow, from: nil)) }
        override func mouseUp(with event: NSEvent) {
            if let result = pendingSearchResult { pendingSearchResult = nil; chooseResult?(result); return }
            up?()
        }
        override func mouseMoved(with event: NSEvent) { hover?(convert(event.locationInWindow,from:nil)) }
        override func mouseExited(with event: NSEvent) { hover?(nil) }
        override func keyDown(with event: NSEvent) { key?(event.charactersIgnoringModifiers ?? "") }
        override func scrollWheel(with event: NSEvent) { zoom?(exp(event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.008 : 0.035)), convert(event.locationInWindow, from:nil)) }
        override func magnify(with event: NSEvent) { zoom?(1 + event.magnification, convert(event.locationInWindow,from:nil)) }
    }
}

private struct GraphSearchResultFramesKey: PreferenceKey {
    static var defaultValue = [String:CGRect]()
    static func reduce(value: inout [String:CGRect], nextValue: () -> [String:CGRect]) { value.merge(nextValue(),uniquingKeysWith:{$1}) }
}

private struct GraphSearchResultHover: ViewModifier {
    @State private var isHovered = false
    func body(content: Content) -> some View {
        content
            .background(isHovered ? Color.white.opacity(0.09) : Color.clear, in:RoundedRectangle(cornerRadius:6))
            .onHover { isHovered = $0 }
            .animation(.easeOut(duration:0.12),value:isHovered)
    }
}

struct GraphWorkspace: View {
    @ObservedObject var model: Inspector
    @StateObject private var layout = GraphLayout()
    @State private var scale: CGFloat = 1
    @State private var offset: CGPoint = .zero
    @State private var dragNode: String?
    @State private var didDrag = false
    @State private var pointerClickCount = 1
    @State private var dragOrigin: CGPoint?
    @State private var startingOffset: CGPoint = .zero
    @State private var hovered: String?
    @State private var searchResultFrames = [String:CGRect]()
    var query: String {model.graphQuery}
    @State private var local = false
    @State private var localDepth = 2
    @State private var labels = true
    @State private var running = true
    @State private var showGraphSettings = false
    @State private var showFilters = true
    @State private var showGroups = false
    @State private var showDisplay = true
    @State private var showForces = false
    @AppStorage("agentbase.graph.arrows") private var arrows = false
    @AppStorage("agentbase.graph.nodeSize") private var nodeSize = 1.0
    @AppStorage("agentbase.graph.linkWidth") private var linkWidth = 1.0
    @AppStorage("agentbase.graph.textFade") private var textFade = 0.5
    @AppStorage("agentbase.graph.orphans") private var orphans = true
    @AppStorage("agentbase.graph.centerForce") private var centerForce = 0.12
    @AppStorage("agentbase.graph.repelForce") private var repelForce = 2200.0
    @AppStorage("agentbase.graph.linkForce") private var linkForce = 0.015
    @AppStorage("agentbase.graph.linkDistance") private var linkDistance = 1.0
    @AppStorage("agentbase.graph.colorMode") private var colorMode = "automatic"
    @State private var hidden = Set<String>(["session"])
    @State private var handledFocus: UUID?
    @State private var knownIDs = Set<String>()
    @State private var restoredPositionsFor: String?
    @State private var restoredCameraFor: String?
    @State private var lastGraphSignature = ""
    @State private var cachedProjectOwners: [String:String] = [:]
    @State private var cachedProjectColors: [String:Color] = [:]
    @State private var didFit = false
    @State private var didSettleFit = false
    @State private var cameraTouched = false
    @State private var size = CGSize(width: 800,height: 700)
    @FocusState private var searchFocused: Bool
    var payload: GraphPayload? { model.snapshot?.graph }
    var graphNodes: [GraphNode] {
        let linked = Set((payload?.edges ?? []).flatMap { [$0.source,$0.target] })
        let allowed = (payload?.nodes ?? []).filter { !hidden.contains($0.kind) && (orphans || linked.contains($0.id)) }
        if local, let id = model.selectedID {
            let near = neighborhood(id, edges: payload?.edges ?? [], depth:localDepth)
            return allowed.filter { near.contains($0.id) }
        }
        return allowed
    }
    var graphEdges: [GraphEdge] { let ids = Set(graphNodes.map(\.id)); return (payload?.edges ?? []).filter { ids.contains($0.source) && ids.contains($0.target) } }
    var matches: [GraphNode] {query.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty ? graphNodes : model.currentSearch?.nodes ?? []}
    private var graphSignature: String { graphNodes.map(\.id).joined() + graphEdges.map { $0.source + $0.target + $0.relation }.joined() }
    func neighborhood(_ id: String, edges: [GraphEdge], depth: Int = 2) -> Set<String> { var ids: Set<String> = [id], frontier: Set<String> = [id]; for _ in 0..<depth { var next = Set<String>(); for edge in edges where edge.relation != "contains" || edge.source == id { if frontier.contains(edge.source) { next.insert(edge.target) }; if frontier.contains(edge.target) { next.insert(edge.source) } }; next.subtract(ids); ids.formUnion(next); frontier = next }; return ids }
    var graphContent: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                Color(white:0.118)
                Canvas { context, canvasSize in draw(context: context,size:canvasSize) }
                    .accessibilityLabel("Knowledge graph: \(graphNodes.count) nodes and \(graphEdges.count) links. Search to select a node.")
                pointerSurface.zIndex(0)
                // GraphPointerSurface is an AppKit NSViewRepresentable. Keep the
                // SwiftUI search panel in a higher hit-testing layer so result
                // buttons receive clicks instead of the canvas drag surface.
                searchControls.zIndex(1)
                settingsOverlay
                if graphNodes.isEmpty { VStack(spacing:8) { Text("No nodes yet").font(.headline); Text("This graph grows as AgentBase records your project work.").font(.caption).foregroundStyle(.secondary) }.frame(maxWidth:.infinity,maxHeight:.infinity).allowsHitTesting(false) }
                graphStatus
            }.coordinateSpace(name:"graph-canvas")
             .onPreferenceChange(GraphSearchResultFramesKey.self) { searchResultFrames = $0 }
             .onAppear { size = geometry.size; applyForceSettings(); syncIfChanged(force:true); syncTimer() }.onChange(of:geometry.size) { _,value in size = value }
        }.onChange(of:model.projectID) { _,_ in knownIDs = []; restoredPositionsFor = nil; restoredCameraFor = nil; didFit = false; didSettleFit = false; cameraTouched = false; offset = .zero; layout.particles = [:]; layout.births = [:]; layout.edgeBirths = [:]; sync() }
         .onChange(of:model.graphQuery) { _,value in if value.count>200 {model.graphQuery=String(value.prefix(200))};model.scheduleGraphSearch() }
    }
    var filteredContent: some View {
        graphContent.onChange(of:model.receivedAt) { _,_ in syncIfChanged() }
         .onChange(of:orphans) { _,_ in syncIfChanged() }
         .onChange(of:hidden) { _,_ in syncIfChanged() }
         .onChange(of:local) { _,_ in syncIfChanged() }
         .onChange(of:localDepth) { _,_ in if local { syncIfChanged() } }
         .onChange(of:model.selectedID) { _,_ in if local { syncIfChanged() } }
    }
    var forceObservedContent: some View {
        filteredContent.onChange(of:centerForce) { _,_ in applyForceSettings() }
         .onChange(of:repelForce) { _,_ in applyForceSettings() }
         .onChange(of:linkForce) { _,_ in applyForceSettings() }
         .onChange(of:linkDistance) { _,_ in applyForceSettings() }
    }
    var body: some View {
        forceObservedContent.onChange(of:model.graphFocusRequest) { _,_ in focusRequested() }.onChange(of:model.includeBackground) { _,_ in model.start() }
         .onChange(of:model.viewMode) { _,_ in syncTimer() }
         .onChange(of:running) { _,_ in syncTimer() }
         .onDisappear { layout.setSimulationRunning(false); savePositions(); saveCamera() }
         .onChange(of:layout.isSettled) { _,settled in
             if settled && !didSettleFit {
                 if !cameraTouched { fit() }
                 didSettleFit = true; savePositions()
             }
         }
    }
    var pointerSurface: some View {
        GraphPointerSurface(down: { point,count in
            cameraTouched = true; dragOrigin = point; startingOffset = offset; dragNode = hit(point)
            didDrag = false; pointerClickCount = count
            layout.pinned = dragNode
        }, moved: { point in
            if let origin = dragOrigin, distance(point,origin) > 4 { didDrag = true }
            if let id = dragNode, didDrag { layout.drag(id,to:world(point)); syncTimer() }
            else if dragNode == nil, let origin = dragOrigin { offset = CGPoint(x:startingOffset.x+point.x-origin.x,y:startingOffset.y+point.y-origin.y) }
        }, up: {
            if !didDrag {
                if let id = dragNode { model.openRecord(id); if pointerClickCount == 2 { local = true } }
                else if dragOrigin != nil { model.selectedID = nil }
            }
            if dragNode != nil && didDrag { layout.release() } else { layout.pinned = nil }
            dragNode = nil; dragOrigin = nil; syncTimer(); savePositions(); saveCamera()
        }, zoom: { factor,anchor in zoom(factor,at:anchor) }, hover: { point in hovered = point.flatMap(hit) }, key: { value in
            if value == "/" { searchFocused = true }
            else if value == "+" || value == "=" { zoom(1.2,at:center) }
            else if value == "-" { zoom(1/1.2,at:center) }
            else if value == "0" { fit() }
            else if value == "\u{1b}" { model.selectedID = nil; model.graphQuery = ""; local = false }
        }, resultFrames:searchResultFrames,results:matches,chooseResult:selectSearchResult)
    }
    var searchControls: some View {
        VStack(alignment: .leading,spacing:8) {
            controls
            if !model.normalizedGraphQuery.isEmpty {
                VStack(alignment:.leading,spacing:0) {
                    Text(model.searchMessage).font(.caption2).foregroundStyle(.secondary).padding(10)
                    if !matches.isEmpty {ScrollView {LazyVStack(alignment:.leading,spacing:0) { ForEach(matches) { node in
                        Button {selectSearchResult(node)} label: {
                            VStack(alignment:.leading,spacing:4) {
                                HStack { Circle().fill(graphColor(node.kind)).frame(width:5,height:5); Text(node.title).lineLimit(1); Spacer(); Text(node.kind).foregroundStyle(.secondary) }
                                if !node.summary.isEmpty {Text(node.summary).font(.caption2).foregroundStyle(.secondary).lineLimit(1)}
                            }.font(.caption).padding(10).contentShape(Rectangle())
                                .background {
                                    GeometryReader { proxy in
                                        Color.clear.preference(key:GraphSearchResultFramesKey.self,value:[node.id:proxy.frame(in:.named("graph-canvas"))])
                                    }
                                }
                        }.buttonStyle(.plain).modifier(GraphSearchResultHover())
                    }}}.frame(height:min(300,CGFloat(matches.count)*56))}
                }.frame(width:320)
                    .background(.regularMaterial,in:RoundedRectangle(cornerRadius:10))
            }
        }.padding(.leading,18).padding(.top,34)
    }
    var settingsOverlay: some View {
        VStack(alignment:.trailing,spacing:8) {
            Button { showGraphSettings.toggle() } label: {
                Image(systemName:showGraphSettings ? "xmark" : "slider.horizontal.3").frame(width:30,height:30)
            }.buttonStyle(.plain).foregroundStyle(.secondary)
                .background(Color(white:0.16),in:RoundedRectangle(cornerRadius:6))
                .help("Graph settings").accessibilityLabel("Graph settings")
            if showGraphSettings { graphSettings }
        }.frame(maxWidth:.infinity,alignment:.trailing).padding(.top,34).padding(.trailing,18)
    }
    var graphStatus: some View {
        VStack { Spacer(); HStack {
            HStack(spacing:6) { Circle().fill(model.paused || model.failure != nil ? Color.orange : accent).frame(width:4,height:4); Text("\(graphNodes.count) nodes · \(graphEdges.count) links"); if (payload?.omitted_nodes ?? 0) > 0 { Text("· \(payload!.omitted_nodes) outside view") }; if payload?.source_truncated == true { Text("· source limited").foregroundStyle(.orange).help("Graph source is limited to the newest 10,000 records per project.") }; if !(payload?.unresolved?.isEmpty ?? true) { Text("· \(payload!.unresolved!.count) unresolved").foregroundStyle(.orange).help(payload!.unresolved!.map { $0.label }.joined(separator:"\n")) } }.font(.system(size:10,design:.monospaced)).foregroundStyle(.secondary)
            Spacer()
            Button(action:fit) { Image(systemName:"arrow.up.left.and.arrow.down.right").frame(width:28,height:28) }.buttonStyle(.plain).foregroundStyle(.secondary).help("Fit graph · 0")
        }.padding(.leading,62).padding(.trailing,18).padding(.vertical,18) }
    }
    func syncTimer() {
        layout.setSimulationRunning(running && model.viewMode == "Graph" && !layout.nodes.isEmpty)
    }
    func applyForceSettings() {
        layout.gravity = centerForce
        layout.repulsion = repelForce
        layout.linkStrength = linkForce
        layout.linkDistance = linkDistance
        layout.invalidateSettlement()
        didSettleFit = false
        syncTimer()
    }
    var graphSettings: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:14) {
                HStack {
                    Text("Graph settings").font(.subheadline.weight(.semibold))
                    Spacer()
                    Button { resetDisplaySettings() } label:{ Image(systemName:"rotate.ccw") }
                        .buttonStyle(.plain).help("Restore default settings")
                }
                DisclosureGroup("Filters",isExpanded:$showFilters) {
                    VStack(alignment:.leading,spacing:10) {
                        Toggle("Orphans",isOn:$orphans)
                        Toggle("Background records",isOn:$model.includeBackground)
                        Toggle("Local graph",isOn:$local)
                        if local { Stepper("Depth: \(localDepth)",value:$localDepth,in:1...4) }
                        Menu("Node types") { ForEach(Array(Set(payload?.nodes.map(\.kind) ?? [])).sorted(),id:\.self) { kind in Toggle(kind.capitalized,isOn:Binding(get:{ !hidden.contains(kind) },set:{ if $0 { hidden.remove(kind) } else { hidden.insert(kind) } })) } }
                    }.padding(.top,10)
                }
                Divider()
                DisclosureGroup("Groups",isExpanded:$showGroups) {
                    Picker("Color by",selection:$colorMode) {
                        Text("None").tag("automatic")
                        Text("Project").tag("project")
                        Text("Node type").tag("type")
                    }.padding(.top,10)
                }
                Divider()
                DisclosureGroup("Display",isExpanded:$showDisplay) {
                    VStack(alignment:.leading,spacing:10) {
                        Toggle("Arrows",isOn:$arrows)
                        Toggle("Labels",isOn:$labels)
                        graphSlider("Text fade threshold",value:$textFade,range:0...1)
                        graphSlider("Node size",value:$nodeSize,range:0.4...2.5)
                        graphSlider("Link thickness",value:$linkWidth,range:0.3...3)
                    }.padding(.top,10)
                }
                Divider()
                DisclosureGroup("Forces",isExpanded:$showForces) {
                    VStack(alignment:.leading,spacing:10) {
                        graphSlider("Center force",value:$centerForce,range:0...0.6)
                        graphSlider("Repel force",value:$repelForce,range:0...8000)
                        graphSlider("Link force",value:$linkForce,range:0...0.06)
                        graphSlider("Link distance",value:$linkDistance,range:0.4...2.5)
                    }.padding(.top,10)
                }
            }.padding(16)
        }.font(.caption).tint(GraphDrawing.highlight).frame(width:260).frame(maxHeight:min(620,max(180,size.height-110)))
            .background(Color(white:0.145),in:RoundedRectangle(cornerRadius:8))
            .overlay(RoundedRectangle(cornerRadius:8).stroke(Color.white.opacity(0.07),lineWidth:1))
            .shadow(color:.black.opacity(0.18),radius:12,y:4)
    }
    func graphSlider(_ title:String,value:Binding<Double>,range:ClosedRange<Double>) -> some View {
        VStack(alignment:.leading,spacing:2) { Text(title).foregroundStyle(.secondary); Slider(value:value,in:range).controlSize(.small) }
    }
    func resetDisplaySettings() {
        centerForce = 0.12; repelForce = 2200; linkForce = 0.015; linkDistance = 1
        arrows = false; labels = true; nodeSize = 1; linkWidth = 1; textFade = 0.5
        colorMode = "automatic"; orphans = true; hidden = ["session"]; local = false
    }
    var controls: some View {
        HStack(spacing:10) {
            WorkspaceNavigation(model:model)
            if !model.isAllProjects {
                Button {if let id=model.currentProject?.id {model.showInGraph(id)}} label:{Image(systemName:"folder")}.buttonStyle(.plain).help("Project folder: " + model.projectFolder).accessibilityLabel("Project folder")
            }
            RecentChangesButton(model:model)
                    ConnectionsButton(model:model.connections,selectedTask:model.selected?.kind == "task" ? model.selected : nil)
            Rectangle().fill(Color.white.opacity(0.12)).frame(width:1,height:16)
            Image(systemName:"magnifyingglass").font(.caption).foregroundStyle(.secondary)
            TextField(model.isAllProjects ? "Search all projects" : "Search project",text:$model.graphQuery).textFieldStyle(.plain).font(.caption).frame(width:140).focused($searchFocused).onSubmit { if let first = model.currentSearch?.nodes.first { selectSearchResult(first) } }.help(model.isAllProjects ? "Search all saved project records · / to focus, Return to open" : "Search saved project text, sources and SQL · / to focus, Return to open")
            if !query.isEmpty {Button {model.graphQuery = ""} label:{Image(systemName:"xmark.circle.fill")}.buttonStyle(.plain).accessibilityLabel("Clear search")}
            Menu {
                Toggle("Show background records",isOn:$model.includeBackground)
                Menu("Node types") { ForEach(Array(Set(payload?.nodes.map(\.kind) ?? [])).sorted(),id:\.self) { kind in Toggle(kind.capitalized,isOn:Binding(get:{ !hidden.contains(kind) },set:{ if $0 { hidden.remove(kind) } else { hidden.insert(kind) } })) } }
                Divider()
                Button("Fit graph",action:fit)
                Button("Reset node positions") { UserDefaults.standard.removeObject(forKey:positionStoreKey); layout.resetPositions(); syncTimer(); didSettleFit = false; fit() }
                Button(running ? "Pause motion" : "Resume motion") { running.toggle() }
                Button("Toggle full screen") {NSApp.keyWindow?.toggleFullScreen(nil)}
                Button(model.paused ? "Resume updates" : "Pause updates",action:model.togglePause)
                Button("Reconnect") { model.start() }
                Button("Choose data store…",action:model.chooseStore)
            } label: { Image(systemName:"ellipsis").frame(width:18,height:20) }.menuStyle(.borderlessButton).fixedSize().help("Graph options")
        }.padding(.horizontal,12).padding(.vertical,9).background(.regularMaterial,in:RoundedRectangle(cornerRadius:10))
    }
    var center: CGPoint { CGPoint(x:size.width/2,y:size.height/2) }
    var positionStoreKey: String {
        let project = model.projectID ?? model.snapshot?.selected_project_id ?? "all"
        return local ? "agentbase.graph.positions.\(project).local.\(model.selectedID ?? "selection")" : "agentbase.graph.positions.\(project)"
    }
    var cameraStoreKey: String {
        GraphCameraPersistence.key(project:model.projectID ?? model.snapshot?.selected_project_id ?? "all",localFocus:local ? model.selectedID ?? "selection" : nil)
    }
    func screen(_ point: CGPoint) -> CGPoint { CGPoint(x:point.x*scale+center.x+offset.x,y:point.y*scale+center.y+offset.y) }
    func world(_ point: CGPoint) -> CGPoint { CGPoint(x:(point.x-center.x-offset.x)/scale,y:(point.y-center.y-offset.y)/scale) }
    func zoom(_ factor: CGFloat, at anchor: CGPoint) { cameraTouched = true; let before = world(anchor); scale = min(5,max(0.12,scale*factor)); offset = CGPoint(x:anchor.x-center.x-before.x*scale,y:anchor.y-center.y-before.y*scale); saveCamera() }
    func hit(_ point: CGPoint) -> String? { graphNodes.min { a,b in distance(point,screen(layout.particles[a.id]?.point ?? .zero)) < distance(point,screen(layout.particles[b.id]?.point ?? .zero)) }.flatMap { n in distance(point,screen(layout.particles[n.id]?.point ?? .zero)) < max(12,nodeRadius(n)*sqrt(scale)+5) ? n.id : nil } }
    func distance(_ a: CGPoint,_ b: CGPoint) -> Double { hypot(a.x-b.x,a.y-b.y) }
    func nodeRadius(_ n: GraphNode) -> Double { GraphDrawing.radius(n) * nodeSize }
    func sync() {
        let allIDs = Set(payload?.nodes.map(\.id) ?? [])
        let fresh = knownIDs.isEmpty ? Set<String>() : allIDs.subtracting(knownIDs)
        knownIDs.formUnion(allIDs)
        layout.sync(nodes:graphNodes,edges:graphEdges,newIDs:fresh)
        syncTimer()
        cachedProjectOwners = projectMembership(nodes:graphNodes,edges:graphEdges)
        cachedProjectColors = projectColors(nodes:graphNodes)
        if restoredPositionsFor != positionStoreKey {
            if let saved = UserDefaults.standard.dictionary(forKey:positionStoreKey) as? [String:[Double]] {
                for (id, point) in saved where point.count == 2 && point[0].isFinite && point[1].isFinite && layout.particles[id] != nil {
                    layout.particles[id] = GraphParticle(point:CGPoint(x:point[0],y:point[1]))
                }
                if !saved.isEmpty { layout.invalidateSettlement() }
            }
            restoredPositionsFor = positionStoreKey
        }
        var restoredCamera = false
        if restoredCameraFor != cameraStoreKey {
            if let camera = GraphCameraPersistence.load(key:cameraStoreKey) {
                scale = camera.scale; offset = camera.offset; cameraTouched = true; restoredCamera = true
            }
            restoredCameraFor = cameraStoreKey
        }
        didSettleFit = false
        if restoredCamera { didFit = true }
        else if !didFit && !graphNodes.isEmpty { fit(); didFit = true }
        focusRequested()
    }
    func syncIfChanged(force: Bool = false) {
        let next = graphSignature
        guard force || next != lastGraphSignature else { return }
        lastGraphSignature = next
        sync()
    }
    func savePositions() {
        let saved = Dictionary(uniqueKeysWithValues:layout.particles.map { ($0.key,[Double($0.value.point.x),Double($0.value.point.y)]) })
        if !saved.isEmpty { UserDefaults.standard.set(saved,forKey:positionStoreKey) }
    }
    func saveCamera() {
        GraphCameraPersistence.save(GraphCameraState(scale:scale,offset:offset),key:cameraStoreKey)
    }
    func projectMembers(_ projectID: String, edges: [GraphEdge]) -> Set<String> {
        var adjacency: [String:[String]] = [:]
        for edge in edges {
            if edge.relation == "contains" { adjacency[edge.source,default:[]].append(edge.target) }
            else {
                adjacency[edge.source,default:[]].append(edge.target)
                adjacency[edge.target,default:[]].append(edge.source)
            }
        }
        var members: Set<String> = [projectID]
        var frontier = [projectID]
        while let current = frontier.popLast() {
            for next in adjacency[current] ?? [] where members.insert(next).inserted { frontier.append(next) }
        }
        return members
    }
    func projectMembership(nodes: [GraphNode], edges: [GraphEdge]) -> [String:String] {
        var adjacency: [String:[String]] = [:]
        for edge in edges {
            if edge.relation == "contains" { adjacency[edge.source,default:[]].append(edge.target) }
            else {
                adjacency[edge.source,default:[]].append(edge.target)
                adjacency[edge.target,default:[]].append(edge.source)
            }
        }
        let roots = Set(nodes.filter { $0.kind == "project" }.map(\.id))
        var owners: [String:String] = [:]
        for projectID in roots {
            var visited: Set<String> = [projectID]
            var frontier = [projectID]
            while !frontier.isEmpty {
                let current = frontier.removeLast()
                for next in adjacency[current] ?? [] where !roots.contains(next) && visited.insert(next).inserted {
                    owners[next] = projectID
                    frontier.append(next)
                }
            }
            owners[projectID] = projectID
        }
        return owners
    }
    func projectColors(nodes: [GraphNode]) -> [String:Color] {
        Dictionary(uniqueKeysWithValues:nodes.filter { $0.kind == "project" }.map { node in
            var hash: UInt64 = 14695981039346656037
            for byte in node.id.utf8 { hash = (hash ^ UInt64(byte)) &* 1099511628211 }
            let hue = Double(hash % 360) / 360
            return (node.id,Color(hue:hue,saturation:0.64,brightness:0.94))
        })
    }
    func focusRequested() {
        guard handledFocus != model.graphFocusRequest, let id = model.graphFocusID, let point = layout.particles[id]?.point else {return}
        handledFocus = model.graphFocusRequest; cameraTouched = true
        if !model.graphFocusPreservesZoom {scale = max(0.7,min(1.6,scale))}; offset = CGPoint(x:-point.x*scale,y:-point.y*scale); hovered = nil; saveCamera()
    }
    func select(_ node: GraphNode) { model.openRecord(node.id); if let p = layout.particles[node.id]?.point { offset = CGPoint(x:-p.x*scale,y:-p.y*scale); cameraTouched = true; saveCamera() } }
    func selectSearchResult(_ node: GraphNode) { hidden.remove(node.kind); searchFocused = false; model.chooseSearchResult(node) }
    func fit() {
        let points = Array(layout.particles.values.map(\.point)); guard !points.isEmpty else { return }
        let minX = points.map(\.x).min()!, maxX = points.map(\.x).max()!, minY = points.map(\.y).min()!, maxY = points.map(\.y).max()!
        scale = max(0.12,min(2,min((size.width-160)/max(100,maxX-minX),(size.height-150)/max(100,maxY-minY))))
        offset = CGPoint(x:-(minX+maxX)/2*scale,y:-(minY+maxY)/2*scale)
        saveCamera()
    }
    func draw(context: GraphicsContext, size: CGSize) {
        GraphDrawing(nodes:graphNodes,edges:graphEdges,particles:layout.particles,scale:scale,offset:offset,
                     selected:hovered ?? model.selectedID,matching:query.isEmpty ? nil : Set(matches.map(\.id)),
                     owners:cachedProjectOwners,colors:cachedProjectColors,colorMode:colorMode,
                     labels:labels,arrows:arrows,nodeSize:nodeSize,linkWidth:linkWidth,textFade:textFade,births:layout.births)
            .draw(context:context,size:size)
    }
}

// Kept independent of the workspace so the same renderer can be exercised in visual fixtures.
struct GraphDrawing {
    static let highlight = Color(red:0.65,green:0.54,blue:0.98)
    static func radius(_ node:GraphNode) -> Double { 3 + min(9,sqrt(Double(max(0,node.degree)))*1.1) }
    let nodes:[GraphNode]
    let edges:[GraphEdge]
    let particles:[String:GraphParticle]
    var scale:CGFloat = 1
    var offset:CGPoint = .zero
    var selected:String? = nil
    var matching:Set<String>? = nil
    var owners:[String:String] = [:]
    var colors:[String:Color] = [:]
    var colorMode = "automatic"
    var labels = true
    var arrows = false
    var nodeSize = 1.0
    var linkWidth = 1.0
    var textFade = 0.5
    var births:[String:TimeInterval] = [:]
    func draw(context:GraphicsContext,size:CGSize) {
        func screen(_ point:CGPoint) -> CGPoint { CGPoint(x:point.x*scale+size.width/2+offset.x,y:point.y*scale+size.height/2+offset.y) }
        // Focus means direct connections, including for project nodes.
        var neighbors = Set<String>()
        if let selected {
            neighbors.insert(selected)
            for edge in edges {
                if edge.source == selected { neighbors.insert(edge.target) }
                if edge.target == selected { neighbors.insert(edge.source) }
            }
        }
        // Render each undirected connection once; relation metadata stays in the model.
        var drawn = Set<String>()
        for edge in edges {
            let key = [edge.source,edge.target].sorted().joined(separator:"|")
            guard drawn.insert(key).inserted,
                  let a = particles[edge.source]?.point, let b = particles[edge.target]?.point else { continue }
            let p = screen(a), q = screen(b)
            let active = selected == edge.source || selected == edge.target
            let opacity = active ? 0.8 : selected == nil ? 0.28 : 0.055
            let color = active ? Self.highlight : Color(white:0.53)
            var path = Path(); path.move(to:p); path.addLine(to:q)
            context.stroke(path,with:.color(color.opacity(opacity)),lineWidth:linkWidth * (active ? 1.2 : 0.7))
            if arrows, let target = nodes.first(where:{$0.id == edge.target}) {
                let angle: CGFloat = atan2(q.y-p.y,q.x-p.x)
                let radius: CGFloat = CGFloat(Self.radius(target)*nodeSize)*sqrt(scale)+3
                let tip = CGPoint(x:q.x-cos(angle)*radius,y:q.y-sin(angle)*radius)
                var arrow = Path()
                arrow.move(to:CGPoint(x:tip.x-cos(angle-0.45)*5,y:tip.y-sin(angle-0.45)*5))
                arrow.addLine(to:tip)
                arrow.addLine(to:CGPoint(x:tip.x-cos(angle+0.45)*5,y:tip.y-sin(angle+0.45)*5))
                context.stroke(arrow,with:.color(color.opacity(opacity)),lineWidth:linkWidth)
            }
        }
        var labelBounds:[CGRect] = []
        let ordered = nodes.sorted { a,b in
            if (a.id == selected) != (b.id == selected) { return a.id == selected }
            if neighbors.contains(a.id) != neighbors.contains(b.id) { return neighbors.contains(a.id) }
            return a.degree != b.degree ? a.degree > b.degree : a.id < b.id
        }
        let labelFade = min(1,max(0,(Double(scale)-(0.15+textFade*0.65))/0.35))
        for node in ordered {
            guard let position = particles[node.id]?.point else { continue }
            let age = births[node.id].map { min(1,max(0,(Date.timeIntervalSinceReferenceDate-$0)/0.8)) } ?? 1
            let growth = age*age*(3-2*age)
            let p = screen(position)
            let radius: CGFloat = CGFloat(Self.radius(node)*nodeSize*(0.25+growth*0.75))*sqrt(scale)
            guard p.x+radius >= 0, p.x-radius <= size.width, p.y+radius >= 0, p.y-radius <= size.height else { continue }
            let active = node.id == selected, related = neighbors.contains(node.id)
            let opacity:Double = matching.map { $0.contains(node.id) ? 1 : 0.12 } ?? (selected != nil && !related ? 0.16 : 1)
            let baseColor = colorMode == "project" ? (colors[owners[node.id] ?? ""] ?? Color(white:0.65)) : colorMode == "type" ? graphColor(node.kind) : Color(white:0.65)
            let color = active ? Self.highlight : baseColor
            context.fill(Path(ellipseIn:CGRect(x:p.x-radius,y:p.y-radius,width:radius*2,height:radius*2)),with:.color(color.opacity(opacity*growth)))
            let fade = active || related ? 1 : min(1,labelFade + min(0.7,Double(node.degree)*0.035))
            guard labels && fade > 0.01 else { continue }
            let maxWidth:CGFloat = active ? 300 : 180
            let title = active ? node.title : node.title.count > 42 ? String(node.title.prefix(40))+"…" : node.title
            let label = context.resolve(Text(title).font(.system(size:active ? 13 : 11)).foregroundColor((active ? Self.highlight : Color(white:0.7)).opacity(opacity*fade)))
            let measured = label.measure(in:CGSize(width:maxWidth,height:active ? 160 : 32))
            let origin = CGPoint(x:p.x+radius+6,y:p.y-measured.height/2)
            let bounds = CGRect(origin:origin,size:measured).insetBy(dx:-3,dy:-2)
            if active || !labelBounds.contains(where:{$0.intersects(bounds)}) {
                context.draw(label,in:CGRect(origin:origin,size:measured))
                labelBounds.append(bounds)
            }
        }
    }
}
