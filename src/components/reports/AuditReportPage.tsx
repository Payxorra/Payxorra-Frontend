'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePrintReport } from '@/src/hooks/usePrintReport';
import { ReportSection } from '@/src/components/reports/ReportSection';
import { type ReportData, splitReportIntoVolumes, type ReportVolume } from '@/src/utils/printHelpers'; // eslint-disable-line @typescript-eslint/no-unused-vars

// Chart implementation using Recharts for interactive view
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';

export function AuditReportPage() {
  const [startDate, setStartDate] = useState('2026-07-01');
  const [endDate, setEndDate] = useState('2026-07-19');
  const [simulateLarge, setSimulateLarge] = useState(false);
  const [activeVolumeIndex, setActiveVolumeIndex] = useState(0);

  const printContainerId = 'report-print-container';
  const { printVolume, isPrinting, volumes, activeVolumeToPrint } = usePrintReport(); // eslint-disable-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-vars

  // TanStack Query to fetch data based on inputs
  const { data, isLoading, refetch, isFetching } = useQuery<ReportData>({
    queryKey: ['audit-report-data', startDate, endDate, simulateLarge],
    queryFn: async () => {
      // Mock network latency
      await new Promise((resolve) => setTimeout(resolve, 800));

      const totalNodes = simulateLarge ? 1300 : 65;
      const totalAlerts = simulateLarge ? 120 : 45;

      const nodeInventory = Array.from({ length: totalNodes }, (_, i) => ({
        id: `node-${i + 1}`,
        label: `Validator ${String.fromCharCode(65 + (i % 26))}-${Math.floor(i / 26) + 1}`,
        location: ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central', 'ap-northeast'][i % 6],
        ownerName: `Organization ${String.fromCharCode(65 + (i % 26))}`,
        ipAddress: `10.0.${Math.floor(i / 4)}.${(i % 4) * 64 + 1}`,
        firmwareVersion: `v${Math.floor(i / 10) + 1}.${i % 10}`,
        uptime: `${95 + (i % 5)}.${(i * 17) % 100}%`,
        status: (i % 15 === 0 ? 'offline' : i % 8 === 0 ? 'degraded' : 'online') as 'online' | 'offline' | 'degraded',
      }));

      const alerts = Array.from({ length: totalAlerts }, (_, i) => ({
        id: `alert-${i + 1}`,
        severity: (i % 7 === 0 ? 'critical' : i % 3 === 0 ? 'warning' : 'info') as 'critical' | 'warning' | 'info',
        message: [
          'High latency detected on validator node',
          'Unscheduled peer disconnection',
          'CPU usage exceeded threshold 90%',
          'System update successfully applied',
          'Database replication lag warning',
        ][i % 5] + ` (Node ${Math.floor(i / 5) + 1})`,
        timestamp: new Date(Date.now() - i * 3600000).toLocaleString(),
        nodeId: `node-${Math.floor(i / 5) + 1}`,
      }));

      const bandwidthGraphs = Array.from({ length: 24 }, (_, i) => ({
        timestamp: Date.now() - (24 - i) * 3600000,
        throughput: Math.floor(800 + Math.sin(i / 3) * 300 + Math.random() * 100),
        latency: Math.floor(15 + Math.cos(i / 4) * 5 + Math.random() * 3),
      }));

      return {
        facilitySummary: {
          healthScore: 98,
          activeNodes: nodeInventory.filter(n => n.status !== 'offline').length,
          totalNodes: nodeInventory.length,
          activeAlerts: alerts.filter(a => a.severity === 'critical').length,
          uptime: '99.98%',
          avgLatency: '18.4ms',
          avgThroughput: '942/s',
        },
        nodeInventory,
        alerts,
        bandwidthGraphs,
      };
    },
    staleTime: 30_000,
  });

  // Calculate volumes for screen rendering & switcher
  const currentVolumes = data ? splitReportIntoVolumes(data) : [];

  // Canvas drawing reference for print layout
  const printCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (activeVolumeToPrint?.bandwidthGraphs && printCanvasRef.current) {
      const canvas = printCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw title
        ctx.fillStyle = '#171512';
        ctx.font = 'bold 16px serif';
        ctx.fillText('Bandwidth Graph (Throughput packets/s)', 30, 40);

        // Draw Axis lines
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(50, 60);
        ctx.lineTo(50, 240);
        ctx.lineTo(750, 240);
        ctx.stroke();

        // Plot data points
        const points = activeVolumeToPrint.bandwidthGraphs;
        const paddingX = 60;
        const paddingY = 60; // eslint-disable-line @typescript-eslint/no-unused-vars
        const width = 700;
        const height = 180;
        const maxThroughput = Math.max(...points.map(p => p.throughput), 1000);

        ctx.strokeStyle = '#0f766e';
        ctx.lineWidth = 2;
        ctx.beginPath();

        points.forEach((p, idx) => {
          const x = paddingX + (idx / (points.length - 1)) * width;
          const y = 240 - (p.throughput / maxThroughput) * height;
          if (idx === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();
      }
    }
  }, [activeVolumeToPrint]);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    refetch();
  };

  const handlePrint = (volumeNum: number) => {
    if (data) {
      printVolume(data, volumeNum, printContainerId);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f4ee] text-[#171512] screen-container">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="border-b border-[#d8d0c1] pb-6 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6f5f48]">
              Compliance & Auditing
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#171512] sm:text-4xl">
              Facility Audit Reports
            </h1>
            <p className="mt-1 text-sm text-[#6f5f48]">
              Generate printable PDF reports of facility health, validator node status, and alert history.
            </p>
          </div>
        </div>

        {/* Date Filter & Control Panel */}
        <form onSubmit={handleGenerate} className="bg-white rounded-xl border border-[#d8d0c1] p-5 shadow-sm mb-8 flex flex-wrap items-end gap-6">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#6f5f48] mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-[#d8d0c1] bg-[#faf8f3] px-3 py-2 text-sm text-[#171512] focus:border-[#0f766e] focus:outline-none"
            />
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#6f5f48] mb-2">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-[#d8d0c1] bg-[#faf8f3] px-3 py-2 text-sm text-[#171512] focus:border-[#0f766e] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 py-2.5">
            <input
              type="checkbox"
              id="simulateLarge"
              checked={simulateLarge}
              onChange={(e) => setSimulateLarge(e.target.checked)}
              className="h-5 w-5 rounded border-[#d8d0c1] text-[#0f766e] focus:ring-[#0f766e]"
            />
            <label htmlFor="simulateLarge" className="text-sm font-semibold text-[#171512] select-none cursor-pointer">
              Simulate Large Dataset (&gt;50 pages)
            </label>
          </div>

          <div>
            <button
              type="submit"
              disabled={isFetching}
              className="w-full rounded-lg bg-[#0f766e] hover:bg-[#115e59] px-6 py-2 text-sm font-semibold text-white transition-colors duration-200 disabled:opacity-50"
            >
              {isFetching ? 'Fetching Data...' : 'Generate Report'}
            </button>
          </div>
        </form>

        {/* Dashboard Preview Interface */}
        {isLoading ? (
          <div className="py-20 text-center text-[#6f5f48]">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
            <p className="mt-4 text-sm font-medium">Fetching and compiling audit data...</p>
          </div>
        ) : !data ? (
          <div className="py-20 text-center border border-dashed border-[#d8d0c1] rounded-xl text-[#6f5f48]">
            Please enter a date range and click &quot;Generate Report&quot;.
          </div>
        ) : (
          <div>
            {/* Volume Status and Switcher */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#faf8f3] border border-[#d8d0c1] rounded-xl p-4 mb-6 gap-4">
              <div>
                <p className="text-sm font-semibold text-[#171512]">
                  Report Compiled successfully: <span className="font-bold text-[#0f766e]">{currentVolumes.length} Volume(s)</span>
                </p>
                <p className="text-xs text-[#6f5f48] mt-1">
                  Each volume is paginated within regulatory limits (&lt;50 pages) for physical printing.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {currentVolumes.map((vol, idx) => (
                  <button
                    key={vol.volumeNumber}
                    onClick={() => {
                      setActiveVolumeIndex(idx);
                    }}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 ${
                      activeVolumeIndex === idx
                        ? 'bg-[#0f766e] border-[#0f766e] text-white'
                        : 'bg-white border-[#d8d0c1] text-[#171512] hover:bg-neutral-50'
                    }`}
                  >
                    Volume {vol.volumeNumber}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Volume Preview Panel */}
            <div className="bg-white rounded-xl border border-[#d8d0c1] p-6 shadow-sm">
              <div className="flex justify-between items-center border-b border-[#ece5d8] pb-4 mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[#171512]">
                    {currentVolumes[activeVolumeIndex]?.title}
                  </h2>
                  <p className="text-xs text-[#6f5f48] mt-0.5">
                    Previewing content that will be formatted in A4 sizing
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => handlePrint(currentVolumes[activeVolumeIndex].volumeNumber)}
                    className="flex items-center gap-2 rounded-lg bg-[#0f766e] hover:bg-[#115e59] px-5 py-2 text-xs font-bold text-white transition-all duration-200"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print / Save as PDF
                  </button>
                </div>
              </div>

              {/* Volume Content Render Preview */}
              <div className="space-y-8">
                {/* 1. Facility Summary */}
                {currentVolumes[activeVolumeIndex]?.facilitySummary && (
                  <div className="border border-[#d8d0c1] rounded-xl p-5 bg-[#faf8f3]">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#6f5f48] mb-4">
                      Facility Performance Summary
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white border border-[#d8d0c1] p-4 rounded-lg">
                        <span className="text-xs text-[#6f5f48]">Health Score</span>
                        <p className="text-2xl font-bold text-teal-700 mt-1">
                          {currentVolumes[activeVolumeIndex].facilitySummary?.healthScore}%
                        </p>
                      </div>
                      <div className="bg-white border border-[#d8d0c1] p-4 rounded-lg">
                        <span className="text-xs text-[#6f5f48]">Active / Total Nodes</span>
                        <p className="text-2xl font-bold text-neutral-800 mt-1">
                          {currentVolumes[activeVolumeIndex].facilitySummary?.activeNodes} / {currentVolumes[activeVolumeIndex].facilitySummary?.totalNodes}
                        </p>
                      </div>
                      <div className="bg-white border border-[#d8d0c1] p-4 rounded-lg">
                        <span className="text-xs text-[#6f5f48]">Active Critical Alerts</span>
                        <p className="text-2xl font-bold text-orange-700 mt-1">
                          {currentVolumes[activeVolumeIndex].facilitySummary?.activeAlerts}
                        </p>
                      </div>
                      <div className="bg-white border border-[#d8d0c1] p-4 rounded-lg">
                        <span className="text-xs text-[#6f5f48]">System Uptime</span>
                        <p className="text-2xl font-bold text-[#171512] mt-1">
                          {currentVolumes[activeVolumeIndex].facilitySummary?.uptime}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Bandwidth Graphs */}
                {currentVolumes[activeVolumeIndex]?.bandwidthGraphs && (
                  <div className="border border-[#d8d0c1] rounded-xl p-5 bg-white">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#6f5f48] mb-4">
                      Bandwidth and Latency Over Time (Interactive Chart)
                    </h3>
                    <div className="h-[250px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={currentVolumes[activeVolumeIndex].bandwidthGraphs} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ece5d8" />
                          <XAxis dataKey="timestamp" tickFormatter={(t) => new Date(t).getHours() + ':00'} tick={{ fontSize: 10, fill: '#6f5f48' }} />
                          <YAxis tick={{ fontSize: 10, fill: '#6f5f48' }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="throughput" stroke="#0f766e" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* 3. Node Inventory */}
                {currentVolumes[activeVolumeIndex]?.nodeInventory.length > 0 && (
                  <div className="border border-[#d8d0c1] rounded-xl overflow-hidden">
                    <div className="bg-[#faf8f3] border-b border-[#d8d0c1] px-5 py-4">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-[#6f5f48]">
                        Node Inventory List ({currentVolumes[activeVolumeIndex].nodeInventory.length} Nodes in this Volume)
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-neutral-50 text-[#6f5f48] border-b border-[#d8d0c1] uppercase font-bold tracking-wider">
                            <th className="px-4 py-3">Label</th>
                            <th className="px-4 py-3">IP Address</th>
                            <th className="px-4 py-3">Location</th>
                            <th className="px-4 py-3">Uptime</th>
                            <th className="px-4 py-3">Firmware</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentVolumes[activeVolumeIndex].nodeInventory.map((node) => (
                            <tr key={node.id} className="border-b border-[#ece5d8] hover:bg-neutral-50">
                              <td className="px-4 py-3 font-semibold text-[#171512]">{node.label}</td>
                              <td className="px-4 py-3 monospace">{node.ipAddress}</td>
                              <td className="px-4 py-3 text-[#6f5f48]">{node.location}</td>
                              <td className="px-4 py-3">{node.uptime}</td>
                              <td className="px-4 py-3 monospace">{node.firmwareVersion}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold ${
                                  node.status === 'online' ? 'bg-green-100 text-green-800' :
                                  node.status === 'offline' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {node.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 4. Alerts Log */}
                {currentVolumes[activeVolumeIndex]?.alerts.length > 0 && (
                  <div className="border border-[#d8d0c1] rounded-xl overflow-hidden">
                    <div className="bg-[#faf8f3] border-b border-[#d8d0c1] px-5 py-4">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-[#6f5f48]">
                        System Alerts Log ({currentVolumes[activeVolumeIndex].alerts.length} Alerts in this Volume)
                      </h3>
                    </div>
                    <div className="divide-y divide-[#ece5d8] max-h-[350px] overflow-y-auto">
                      {currentVolumes[activeVolumeIndex].alerts.map((alert) => (
                        <div key={alert.id} className="px-5 py-3 hover:bg-neutral-50 flex items-start gap-4 text-xs">
                          <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase ${
                            alert.severity === 'critical' ? 'bg-red-100 text-red-800' :
                            alert.severity === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {alert.severity}
                          </span>
                          <div className="flex-1">
                            <p className="font-semibold text-[#171512]">{alert.message}</p>
                            <p className="text-[10px] text-[#6f5f48] mt-0.5">{alert.timestamp}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* HIDDEN PRINT-ONLY CONTAINER (Rendered only during window.print()) */}
      {activeVolumeToPrint && (
        <div id={printContainerId} className="print-container hidden" style={{ display: 'none' }}>
          {/* Cover Page */}
          <div className="report-cover-page text-center py-20 border-b border-[#cccccc] break-after-page" style={{ height: '90%' }}>
            <h1 className="text-3xl font-bold uppercase tracking-widest text-neutral-800">Lumina Network</h1>
            <h2 className="text-2xl font-semibold mt-4 text-neutral-700">Offline Facility Health & Audit Report</h2>
            <p className="text-md mt-6 font-bold text-teal-800">
              Volume {activeVolumeToPrint.volumeNumber}
            </p>
            <p className="text-sm text-neutral-500 mt-2">{activeVolumeToPrint.title}</p>
            <div className="mt-16 text-xs text-neutral-400 space-y-2">
              <p>Generated: {new Date().toLocaleString()}</p>
              <p>Reporting Period: {startDate} to {endDate}</p>
              <p>Regulatory Standard compliance: ISO 27001 / SOC 2 Type II / HIPAA Audited</p>
            </div>
          </div>

          {/* Repeating Header & Footer for Print Pages */}
          <div className="print-header">
            <span>LUMINA NETWORK AUDIT REPORT - VOL {activeVolumeToPrint.volumeNumber}</span>
            <span>Date: {startDate} - {endDate}</span>
          </div>

          <div className="print-footer">
            <span>Security Classification: Restricted</span>
            <span>Page <span className="print-page-number"></span></span>
          </div>

          {/* Section 1: Facility Summary */}
          {activeVolumeToPrint.facilitySummary && (
            <ReportSection title="Facility Summary Dashboard" breakAfter={true}>
              <div className="grid grid-cols-2 gap-4 my-4 p-4 border border-[#cccccc] rounded bg-white">
                <div>
                  <span className="text-xs uppercase font-bold text-neutral-500">Overall Health Score</span>
                  <p className="text-xl font-bold text-teal-800">{activeVolumeToPrint.facilitySummary.healthScore}%</p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold text-neutral-500">Active / Total Nodes</span>
                  <p className="text-xl font-bold text-neutral-800">
                    {activeVolumeToPrint.facilitySummary.activeNodes} / {activeVolumeToPrint.facilitySummary.totalNodes}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold text-neutral-500">Active Critical Alerts</span>
                  <p className="text-xl font-bold text-red-700">{activeVolumeToPrint.facilitySummary.activeAlerts}</p>
                </div>
                <div>
                  <span className="text-xs uppercase font-bold text-neutral-500">Facility Rolling Uptime</span>
                  <p className="text-xl font-bold text-neutral-800">{activeVolumeToPrint.facilitySummary.uptime}</p>
                </div>
              </div>
            </ReportSection>
          )}

          {/* Section 2: Bandwidth Graphs (Renders Canvas 2D for Rasterizer to parse) */}
          {activeVolumeToPrint.bandwidthGraphs && (
            <ReportSection title="Bandwidth and Throughput Metrics" breakAfter={true}>
              <div className="my-4 border border-[#cccccc] p-2 bg-white flex justify-center">
                <canvas
                  ref={printCanvasRef}
                  width={800}
                  height={300}
                  className="w-full max-w-[800px]"
                />
              </div>
            </ReportSection>
          )}

          {/* Section 3: Node Inventory */}
          {activeVolumeToPrint.nodeInventory.length > 0 && (
            <ReportSection title={`Node Inventory (${activeVolumeToPrint.nodeInventory.length} Nodes)`} breakAfter={activeVolumeToPrint.alerts.length > 0}>
              <table className="w-full border-collapse text-left text-xs my-4">
                <thead>
                  <tr className="border-b border-[#cccccc] font-bold text-neutral-600 bg-neutral-100">
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">IP Address</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Uptime</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeVolumeToPrint.nodeInventory.map((node) => (
                    <tr key={node.id} className="border-b border-[#dddddd]">
                      <td className="px-3 py-2 font-bold">{node.label}</td>
                      <td className="px-3 py-2 monospace">{node.ipAddress}</td>
                      <td className="px-3 py-2">{node.location}</td>
                      <td className="px-3 py-2">{node.uptime}</td>
                      <td className="px-3 py-2 font-semibold uppercase">{node.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportSection>
          )}

          {/* Section 4: Alerts */}
          {activeVolumeToPrint.alerts.length > 0 && (
            <ReportSection title={`Alerts Log (${activeVolumeToPrint.alerts.length} Alerts)`} breakAfter={false}>
              <table className="w-full border-collapse text-left text-xs my-4">
                <thead>
                  <tr className="border-b border-[#cccccc] font-bold text-neutral-600 bg-neutral-100">
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Message</th>
                    <th className="px-3 py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {activeVolumeToPrint.alerts.map((alert) => (
                    <tr key={alert.id} className="border-b border-[#dddddd]">
                      <td className="px-3 py-2 font-bold uppercase">{alert.severity}</td>
                      <td className="px-3 py-2">{alert.message}</td>
                      <td className="px-3 py-2">{alert.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportSection>
          )}
        </div>
      )}
    </main>
  );
}
