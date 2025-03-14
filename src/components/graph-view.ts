import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import * as d3 from 'd3';

// Типы для удобства
interface GraphNode {
    address: string;
    address_name?: string;
    type?: string;
    x?: number; 
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
    id: string;
    from: string;
    to: string;
}

interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

@customElement('graph-view')
export class GraphView extends LitElement {
    static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }
    svg {
      width: 100%;
      height: 100vh;
      background: #000;
    }
    .link {
      stroke: #999;
      stroke-opacity: 0.6;
    }
    .node {
      cursor: pointer;
      stroke: #fff;
      stroke-width: 1.5px;
    }
    .node text {
      pointer-events: none;
      font-size: 12px;
      font-family: sans-serif;
    }
    .link-label {
      font-size: 10px;
      fill: #555;
      pointer-events: none;
    }
    .node-label {
      font-size: 16px;
      fill: #fff;
      pointer-events: none;
    }
  `;

    @state()
    private graphData: GraphData = {
        nodes: [],
        links: [],
    };

    // D3 объекты
    private svg?: d3.Selection<SVGSVGElement | null, unknown, null, undefined>;
    private linkGroup?: d3.Selection<SVGGElement, unknown, null, undefined>;
    private nodeGroup?: d3.Selection<SVGGElement, unknown, null, undefined>;
    private labelGroup?: d3.Selection<SVGGElement, unknown, null, undefined>;

    private simulation?: d3.Simulation<GraphNode, undefined>;

    private currentFileIndex = 1;

    private async fetchGraphData(fileIndex: number, address: string) {
        try {
            const url = `/data/${fileIndex}.json?address=${address}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                console.error(`Ошибка загрузки графа из ${url}`);
                return;
            }
            const data: GraphData = await resp.json();
            // Обновляем граф, если адрес найден под ключом "to" в links
            const linkContainsAddressTo = data.links.some(link => link.from === address);
            if (linkContainsAddressTo) {
                this.updateGraph(data);
                this.currentFileIndex++;
            } else {
                console.log(`Адрес ${address} не найден как "to" в ${fileIndex}.json`);
            }
        } catch (error) {
            console.error('Ошибка запроса графа:', error);
        }
    }

    firstUpdated() {
        this.initSvg();
        this.fetchGraphData(this.currentFileIndex, '0x2be59e62d811a1a8a25a937c4812313cf8bbe428');
    }



    // Инициализация базовой структуры D3
    private initSvg() {
        this.svg = d3
            .select(this.renderRoot.querySelector('svg'))
            .attr('width', '100%')
            .attr('height', '100%');

        this.linkGroup = this.svg.append('g').attr('class', 'links');
        this.nodeGroup = this.svg.append('g').attr('class', 'nodes');
        this.labelGroup = this.svg.append('g').attr('class', 'labels');

        // Создаём force-систему
        this.simulation = d3
            .forceSimulation<GraphNode>()
            .force(
                'link',
                d3.forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>()
                    .id((d) => d.address)
                    .distance(80)
            )
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2))
            .on('tick', () => this.ticked());
    }

    private updateGraph(newData: GraphData) {
        // Сольём ноды (учитывая, что ключ - это address)
        const existingNodesMap = new Map(this.graphData.nodes.map((n) => [n.address, n]));
        newData.nodes.forEach((node) => {
            if (!existingNodesMap.has(node.address)) {
                existingNodesMap.set(node.address, node);
            }
        });
        const mergedNodes = Array.from(existingNodesMap.values());

        // Сольём линки (учитывая, что ключ - это id)
        const existingLinksMap = new Map(this.graphData.links.map((l) => [l.id, l]));
        newData.links.forEach((link) => {
            if (!existingLinksMap.has(link.id)) {
                existingLinksMap.set(link.id, link);
            }
        });
        const mergedLinks = Array.from(existingLinksMap.values());

        mergedLinks.forEach(link => {
            link.source = mergedNodes.find(n => n.address === link.from)!;
            link.target = mergedNodes.find(n => n.address === link.to)!;
        });

        this.graphData = {
            nodes: mergedNodes,
            links: mergedLinks,
        };

        // Обновляем D3
        this.renderGraph();
    }

    // Перерисовываем граф
    private renderGraph() {
        if (!this.simulation) return;

        // Обновляем силы (force)
        const linkForce = this.simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>;
        linkForce.links(this.graphData.links as GraphLink[]);

        // ====== LINKS ======
        const linkSelection = this.linkGroup!
            .selectAll<SVGLineElement, GraphLink>('line')
            .data(this.graphData.links, (d: any) => d.id);

        // EXIT
        linkSelection.exit().remove();

        // ENTER
        const linkEnter = linkSelection
            .enter()
            .append('line')
            .attr('class', 'link')
            .style('stroke-width', 1);

        // UPDATE + ENTER
        linkSelection.merge(linkEnter);

        // ====== NODES ======
        const nodeSelection = this.nodeGroup!
            .selectAll<SVGCircleElement, GraphNode>('circle')
            .data(this.graphData.nodes, (d: any) => d.address);

        // EXIT
        nodeSelection.exit().remove();

        // ENTER
        const nodeEnter = nodeSelection
            .enter()
            .append('circle')
            .attr('class', 'node')
            .attr('r', 12)
            .on('click', (_event, d) => this.onNodeClick(d))
            .call(
                d3
                    .drag<SVGCircleElement, GraphNode>()
                    .on('start', (event, d) => this.dragstarted(event, d))
                    .on('drag', (event, d) => this.dragged(event, d))
                    .on('end', (event, d) => this.dragended(event, d))
            )
            .on('click', (_, d) => this.onNodeClick(d));

        // UPDATE + ENTER
        nodeSelection.merge(nodeEnter).attr('fill', (d) => this.getNodeColor(d));

        // ====== LABELS (подписи к нодам) ======
        const labelSelection = this.labelGroup!
            .selectAll<SVGTextElement, GraphNode>('text')
            .data(this.graphData.nodes, (d: any) => d.address);

        // EXIT
        labelSelection.exit().remove();

        // ENTER
        const labelEnter = labelSelection
            .enter()
            .append('text')
            .attr('class', 'node-label')
            .attr('text-anchor', 'middle')
            .attr('dy', '-1.2em')
            .text((d) => this.getNodeLabel(d));

        // UPDATE + ENTER
        labelSelection.merge(labelEnter).text((d) => this.getNodeLabel(d));

        // Запускаем перезапуск симуляции
        this.simulation.nodes(this.graphData.nodes);
        this.simulation.alpha(1).restart();
    }

    // Возвращаем цвет для ноды (пример)
    private getNodeColor(node: GraphNode): string {
        switch (node.type) {
            case 'cex':
                return 'orange';
            case 'stakingpool':
                return 'purple';
            case 'token':
                return 'green';
            case 'dao':
                return 'blue';
            case 'gambling':
                return 'red';
            default:
                return '#666';
        }
    }

    // Подпись для ноды
    private getNodeLabel(node: GraphNode): string {
        // Если есть address_name, используем его, иначе — короткий address
        if (node.address_name) {
            return node.address_name;
        }
        return node.address.slice(0, 6) + '...' + node.address.slice(-4);
    }

    // D3-обработчики drag
    private dragstarted(event: d3.D3DragEvent<SVGCircleElement, GraphNode, unknown>, d: GraphNode) {
        if (!event.active && this.simulation) {
            this.simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
    }

    private dragged(event: d3.D3DragEvent<SVGCircleElement, GraphNode, unknown>, d: GraphNode) {
        d.fx = event.x;
        d.fy = event.y;
    }

    private dragended(event: d3.D3DragEvent<SVGCircleElement, GraphNode, unknown>, d: GraphNode) {
        if (!event.active && this.simulation) {
            this.simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
    }

    // Клик по ноде: запрашиваем новые данные
    private async onNodeClick(d: GraphNode) {
        console.log('Нажата нода:', d.address, this.currentFileIndex);
        if (this.currentFileIndex <= 3) { // Если есть еще файлы (например, до 3.json)

            this.fetchGraphData(this.currentFileIndex, d.address);

        }
    }


    // Функция, которая вызывается при каждом "тике" симуляции
    private ticked() {
        // Обновляем позиции ссылок
        this.linkGroup!
            .selectAll<SVGLineElement, GraphLink>('line')
            .attr('x1', (d) => (d.source ? (d.source as GraphNode).x ?? 0 : 0))
            .attr('y1', (d) => (d.source ? (d.source as GraphNode).y ?? 0 : 0))
            .attr('x2', (d) => (d.target ? (d.target as GraphNode).x ?? 0 : 0))
            .attr('y2', (d) => (d.target ? (d.target as GraphNode).y ?? 0 : 0));

        // Обновляем позиции нод
        this.nodeGroup!
            .selectAll<SVGCircleElement, GraphNode>('circle')
            .attr('cx', (d) => d.x ?? 0)
            .attr('cy', (d) => d.y ?? 0);

        // Обновляем позиции лейблов
        this.labelGroup!
            .selectAll<SVGTextElement, GraphNode>('text')
            .attr('x', (d) => d.x ?? 0)
            .attr('y', (d) => (d.y ?? 0) - 15);
    }

    render() {
        return html`
      <svg></svg>
      <!-- Если нужно, можно добавить какие-то элементы управления -->
    `;
    }
}
