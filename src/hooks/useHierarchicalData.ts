import { useMemo } from 'react';
import * as d3 from 'd3';

export interface FlatNetworkNode {
  id: string;
  name: string;
  type: 'region' | 'facility' | 'rack' | 'node' | 'sensor';
  status: 'healthy' | 'warning' | 'critical';
  region?: string;
  facility?: string;
  rack?: string;
  node?: string;
}

interface HierarchyRawNode {
  id: string;
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  children?: Map<string, HierarchyRawNode> | HierarchyRawNode[];
}

export const useHierarchicalData = (nodeList: FlatNetworkNode[]) => {
  return useMemo(() => {
    if (!nodeList || nodeList.length === 0) return null;

    // Root structure
    const rootData: HierarchyRawNode = {
      id: 'root',
      name: 'Network Root',
      status: 'healthy',
      children: new Map(),
    };

    // Helper to resolve status aggregation up the tree
    const worstStatus = (s1: string, s2: string): 'healthy' | 'warning' | 'critical' => {
      if (s1 === 'critical' || s2 === 'critical') return 'critical';
      if (s1 === 'warning' || s2 === 'warning') return 'warning';
      return 'healthy';
    };

    // Build the map-based tree structure
    nodeList.forEach((item) => {
      const regionName = item.region || 'Uncategorized';
      const facilityName = item.facility || 'Uncategorized';
      const rackName = item.rack || 'Uncategorized';
      const nodeName = item.node || 'Uncategorized';

      // 1. Region Level
      let region = (rootData.children as Map<string, HierarchyRawNode>).get(regionName);
      if (!region) {
        region = { id: `region-${regionName}`, name: regionName, status: 'healthy', children: new Map() };
        (rootData.children as Map<string, HierarchyRawNode>).set(regionName, region);
      }
      region.status = worstStatus(region.status, item.status);

      // 2. Facility Level
      let facility = (region.children as Map<string, HierarchyRawNode>).get(facilityName);
      if (!facility) {
        facility = { id: `facility-${facilityName}`, name: facilityName, status: 'healthy', children: new Map() };
        (region.children as Map<string, HierarchyRawNode>).set(facilityName, facility);
      }
      facility.status = worstStatus(facility.status, item.status);

      // 3. Rack Level
      let rack = (facility.children as Map<string, HierarchyRawNode>).get(rackName);
      if (!rack) {
        rack = { id: `rack-${rackName}`, name: rackName, status: 'healthy', children: new Map() };
        (facility.children as Map<string, HierarchyRawNode>).set(rackName, rack);
      }
      rack.status = worstStatus(rack.status, item.status);

      // 4. Node Level
      let node = (rack.children as Map<string, HierarchyRawNode>).get(nodeName);
      if (!node) {
        node = { id: `node-${nodeName}`, name: nodeName, status: 'healthy', children: new Map() };
        (rack.children as Map<string, HierarchyRawNode>).set(nodeName, node);
      }
      node.status = worstStatus(node.status, item.status);

      // 5. Sensor Level (Leaf Node)
      if (item.type === 'sensor') {
        const sensorMap = node.children as Map<string, HierarchyRawNode>;
        sensorMap.set(item.id, { id: item.id, name: item.name, status: item.status, children: [] });
      }
    });

    // Recursively convert Maps to Arrays for D3 compatibility
    const formatChildren = (node: HierarchyRawNode): unknown => {
      if (node.children instanceof Map) {
        node.children = Array.from(node.children.values()).map(formatChildren);
      }
      return node;
    };

    const formattedRoot = formatChildren(rootData);
    
    // Create D3 Hierarchy
    return d3.hierarchy(formattedRoot);
  }, [nodeList]);
};