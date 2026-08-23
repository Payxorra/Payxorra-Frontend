import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { configureTreeLayout } from "../../lib/d3/treeLayout";

interface TreeViewProps {
  data: d3.HierarchyNode<unknown>;
  width?: number;
  height?: number;
}

function getThemeColor(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

function resolveStatusColor(status: string): string {
  const map: Record<string, string> = {
    healthy: getThemeColor('--color-status-healthy'),
    warning: getThemeColor('--color-status-warning'),
    critical: getThemeColor('--color-status-critical'),
  }
  return map[status] || getThemeColor('--color-muted')
}

export const TreeView: React.FC<TreeViewProps> = ({
  data,
  width = 960,
  height = 600,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gContainerRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const svg = d3.select(svgRef.current);
    const gContainer = d3.select(gContainerRef.current);
    const treeLayout = configureTreeLayout(width, height);

    // Track layout IDs to persist toggle state across renders
    let i = 0;

    // Initialize root position coordinates
    const root = data as unknown;
    root.x0 = height / 2;
    root.y0 = 0;

    // Explicitly collapse everything beyond Level 2 (Region) on initial load
    if (root.children) {
      root.children.forEach(collapseSubtree);
    }

    function collapseSubtree(d: unknown) {
      if (d.children) {
        d._children = d.children;
        d._children.forEach(collapseSubtree);
        d.children = null;
      }
    }

    // Set up Pan and Zoom behavior bounds
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on("zoom", (event) => {
        gContainer.attr("transform", event.transform);
      });

    svg.call(zoomBehavior);

    // Initial Tree Render Call
    update(root);

    function update(source: unknown) {
      const treeData = treeLayout(root);
      const nodes = treeData.descendants();
      const links = treeData.links();

      // Enforce normalized tree level depths
      nodes.forEach((d: unknown) => {
        d.y = d.depth * 180;
      });

      // --- Node Management ---
      const node = gContainer
        .selectAll("g.node")
        .data(nodes, (d: unknown) => d.id || (d.id = ++i));

      // Enter phase: Instantiate missing nodes at parent's previous position
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node")
        .attr("transform", () => `translate(${source.y0},${source.x0})`)
        .on("click", (event, d: unknown) => {
          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else {
            d.children = d._children;
            d._children = null;
          }
          update(d);
        })
        .style("cursor", "pointer");

      nodeEnter
        .append("circle")
        .attr("r", 1e-6)
        .style(
          "fill",
          (d: unknown) => resolveStatusColor(d.data.status),
        );

      nodeEnter
        .append("text")
        .attr("dy", ".35em")
        .attr("x", (d: unknown) => (d.children || d._children ? -13 : 13))
        .attr("text-anchor", (d: unknown) =>
          d.children || d._children ? "end" : "start",
        )
        .text((d: unknown) => d.data.name)
        .style("fill-opacity", 1e-6)
        .style("font-size", "12px")
        .style("user-select", "none")
        .attr("class", "fill-foreground font-medium");

      // Update phase: Smoothly transition nodes to their newly calculated positions
      const nodeUpdate = node
        .merge(nodeEnter as unknown)
        .transition()
        .duration(400)
        .ease(d3.easeCubicInOut)
        .attr("transform", (d: unknown) => `translate(${d.y},${d.x})`);

      nodeUpdate
        .select("circle")
        .attr("r", 7)
        .style(
          "fill",
          (d: unknown) => resolveStatusColor(d.data.status),
        )
        .style("stroke", () => getThemeColor('--color-surface'))
        .style("stroke-width", "2px");

      nodeUpdate.select("text").style("fill-opacity", 1);

      // Handle independent 200 ms color transitions on state/status mutations
      node
        .select("circle")
        .transition()
        .duration(200)
        .style(
          "fill",
          (d: unknown) => resolveStatusColor(d.data.status),
        );

      // Exit phase: Transition departing nodes back to the clicked parent node
      const nodeExit = node
        .exit()
        .transition()
        .duration(400)
        .ease(d3.easeCubicInOut)
        .attr("transform", () => `translate(${source.y},${source.x})`)
        .remove();

      nodeExit.select("circle").attr("r", 1e-6);
      nodeExit.select("text").style("fill-opacity", 1e-6);

      // --- Link Management ---
      const link = gContainer
        .selectAll("path.link")
        .data(links, (d: unknown) => d.target.id);

      // Generating clean standard horizontal curved path connections
      const diagonal = d3
        .linkHorizontal()
        .x((d: unknown) => d.y)
        .y((d: unknown) => d.x);

      // Enter phase: Generate links collapsing into parent node
      const linkEnter = link
        .enter()
        .insert("path", "g")
        .attr("class", "link")
        .attr("d", () => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o } as unknown);
        })
        .style("fill", "none")
        .style("stroke", () => getThemeColor('--color-border'))
        .style("stroke-width", "1.5px");

      // Update phase: Standard view transitions for expanding paths
      link
        .merge(linkEnter as unknown)
        .transition()
        .duration(400)
        .ease(d3.easeCubicInOut)
        .attr("d", diagonal as unknown);

      // Exit phase: Contract links back down into structural parent node
      link
        .exit()
        .transition()
        .duration(400)
        .ease(d3.easeCubicInOut)
        .attr("d", () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o } as unknown);
        })
        .remove();

      // Cache structural positional history for subsequent animation runs
      nodes.forEach((d: unknown) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }
  }, [data, width, height]);

  return (
    <div className="w-full h-full border border-border rounded-xl overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full h-full select-none"
      >
        <g ref={gContainerRef} transform="translate(80, 40)" />
      </svg>
    </div>
  );
};
