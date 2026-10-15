import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CATEGORIES } from '../../data/mockData';
import './CategoryPills.css';

export default function CategoryPills() {
  const { activeCategory, setActiveCategory, setCurrentView, activeChannelFilter, filterByChannel } = useApp();
  const scrollRef = useRef(null);

  function scrollLeft() {
    scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' });
  }

  function scrollRight() {
    scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' });
  }

  function handleCategoryClick(cat) {
    setActiveCategory(cat);
    setCurrentView('all');
    if (activeChannelFilter) {
      filterByChannel(null);
    }
  }

  return (
    <div className="category-pills" role="navigation" aria-label="Video categories">
      <button
        className="category-pills__arrow category-pills__arrow--left"
        onClick={scrollLeft}
        aria-label="Scroll categories left"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="category-pills__track" ref={scrollRef} role="list">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            role="listitem"
            className={`category-pills__pill ${activeCategory === cat ? 'category-pills__pill--active' : ''}`}
            onClick={() => handleCategoryClick(cat)}
            aria-pressed={activeCategory === cat}
            id={`category-pill-${cat.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <button
        className="category-pills__arrow category-pills__arrow--right"
        onClick={scrollRight}
        aria-label="Scroll categories right"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
