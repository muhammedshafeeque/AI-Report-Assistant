
import './App.css'
import { Routes, Route } from 'react-router-dom'
import { ChatBot } from './Pages/ChatBot'
function App() {

  return (
    <>
      <Routes>
        <Route path="/" element={<ChatBot />} />
      </Routes>
    </>
  )
}

export default App
