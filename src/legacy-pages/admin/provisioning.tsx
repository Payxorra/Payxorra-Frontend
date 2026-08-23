import React, { useState, useEffect } from 'react';
import { useBluetoothProvisioning } from '../../hooks/useBluetoothProvisioning';
import { BLEScanSheet } from '../../components/provisioning/BLEScanSheet';
import { ConfigPayloadEditor } from '../../components/provisioning/ConfigPayloadEditor';
import { decodeResponse } from '../../lib/bluetooth/provisioningProtocol';

type Step = 'scan' | 'configure' | 'verify';

export default function ProvisioningConsole() {
  const [step, setStep] = useState<Step>('scan');
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const { 
    device, 
    writeChar, 
    notifyChar, 
    isConnected, 
    error, 
    connect, 
    disconnect 
  } = useBluetoothProvisioning();

    useEffect(() => {
      if (isConnected && notifyChar) {
       const handleNotification = async (event: Event) => {
         const value = (event.target as unknown as BluetoothRemoteGATTCharacteristic).value;
         if (value) {
           const result = decodeResponse(value);
           setVerificationResult(result);
         }
       };

        const startNotifications = async () => {
          try {
            await notifyChar.startNotifications();
            notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
          } catch {
            console.error('Failed to start notifications');
          }
        };

        startNotifications();

        return () => {
          notifyChar.removeEventListener('characteristicvaluechanged', handleNotification);
          notifyChar.stopNotifications().catch(() => {});
        };
      }
    }, [isConnected, notifyChar]);

  const handleConnect = async () => {
    try {
      await connect();
      setIsScanOpen(false);
      setStep('configure');
    } catch {
      // error state in hook handles this
    }
  };

  const handleWriteSuccess = () => {
    setVerificationResult(null);
    setStep('verify');
  };

  const handleWriteError = (err: string) => {
    alert(`Error: ${err}`);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Provisioning Console</h1>
          <p className="text-muted">Configure and provision new BLE sensor nodes</p>
        </div>
        {isConnected && (
          <button 
            onClick={disconnect} 
            className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
          >
            Disconnect
          </button>
        )}
      </header>

      <div className="flex justify-between mb-8 relative">
        {['scan', 'configure', 'verify'].map((s, idx) => (
          <div key={s} className="flex flex-col items-center z-10">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
              step === s ? 'bg-primary text-primary-text' : 'bg-surface-alt text-muted'
            }`}>
              {idx + 1}
            </div>
            <span className="text-xs mt-2 capitalize">{s}</span>
          </div>
        ))}
        <div className="absolute top-5 left-0 w-full h-0.5 bg-surface-alt z-0"></div>
        <div 
          className="absolute top-5 left-0 h-0.5 bg-primary transition-all duration-300 z-0"
          style={{ width: step === 'scan' ? '0%' : step === 'configure' ? '33.3%' : '66.6%' }}
        ></div>
      </div>

      <main className="bg-surface border rounded-xl p-6 shadow-sm min-h-100">
        {step === 'scan' && (
          <div className="flex flex-col items-center justify-center h-full py-20">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a9.05 9.05 0 0112.728 0m-15.557-3.636a12 12 0 0116.666 0" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold">Ready to Scan</h2>
              <p className="text-muted">Click the button below to search for BLE devices</p>
            </div>
            <button
              onClick={() => setIsScanOpen(true)}
              className="px-8 py-3 bg-primary text-primary-text rounded-lg font-medium hover:bg-primary-hover transition-colors shadow-lg shadow-blue-200"
            >
              Open Device Scanner
            </button>
          </div>
        )}

        {step === 'configure' && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold mb-4">Configuration</h2>
            <ConfigPayloadEditor 
              writeCharacteristic={writeChar} 
              onWriteSuccess={handleWriteSuccess}
              onWriteError={handleWriteError}
            />
            <button 
              onClick={() => setStep('scan')}
              className="mt-4 text-sm text-muted hover:text-foreground"
            >
              &larr; Back to scan
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div className="flex flex-col items-center justify-center py-20">
            <h2 className="text-xl font-semibold mb-6">Verifying Handshake...</h2>
            
            {!verificationResult ? (
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-muted">Waiting for response from node</p>
              </div>
            ) : (
              <div className={`p-8 rounded-2xl text-center border-2 ${
                verificationResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                  verificationResult.success ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                }`}>
                  {verificationResult.success ? (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <h3 className={`text-lg font-bold ${verificationResult.success ? 'text-green-800' : 'text-red-800'}`}>
                  {verificationResult.success ? 'Provisioning Successful!' : 'Provisioning Failed'}
                </h3>
                <p className="text-muted mt-2">{verificationResult.message}</p>
                <button 
                  onClick={() => {
                    setVerificationResult(null);
                    setStep('configure');
                  }}
                  className="mt-6 px-4 py-2 bg-surface border rounded-lg hover:bg-surface-alt transition-colors"
                >
                  Retry Configuration
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <BLEScanSheet 
        isOpen={isScanOpen}
        onClose={() => setIsScanOpen(false)}
        onScan={handleConnect}
        device={device}
        isConnected={isConnected}
        error={error}
      />
    </div>
  );
}
